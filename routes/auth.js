const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");

const router = express.Router();

// Rate limiting to prevent brute force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: "Too many authentication attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: "Too many accounts created, please try again later",
});

// Input validation middleware
const registerValidation = [
  body("username")
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage("Username must be 3-30 characters")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("Username can only contain letters, numbers, and underscores"),
  body("email")
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage("Must be a valid email"),
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage("Password must contain uppercase, lowercase, and number"),
];

const loginValidation = [
  body("email").trim().isEmail().normalizeEmail(),
  body("password").notEmpty().withMessage("Password is required"),
];

// Registration endpoint
router.post("/register", registerLimiter, registerValidation, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, email, password } = req.body;

    // Check if user already exists (single query for both)
    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    }).select("_id email username").lean();

    if (existingUser) {
      const field = existingUser.email === email ? "email" : "username";
      return res.status(409).json({ 
        message: `User with this ${field} already exists` 
      });
    }

    // Hash password with optimal cost factor
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create new user
    const newUser = new User({ 
      username, 
      email, 
      password: hashedPassword 
    });
    
    await newUser.save();

    // Log successful registration (use proper logging in production)
    console.log(`New user registered: ${username} (${email})`);

    res.status(201).json({ 
      message: "User registered successfully",
      username: newUser.username 
    });
  } catch (err) {
    // Log error with context (use proper error logging service)
    console.error("Registration error:", err);
    
    // Don't expose internal errors to client
    res.status(500).json({ 
      message: "An error occurred during registration" 
    });
  }
});

// Login endpoint
router.post("/login", authLimiter, loginValidation, async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Fetch only needed fields
    const user = await User.findOne({ email })
      .select("_id username email password")
      .lean();

    // Use constant-time comparison to prevent timing attacks
    if (!user) {
      // Still hash to prevent timing attacks
      await bcrypt.hash(password, 12);
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Validate JWT_SECRET exists
    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET is not defined");
      return res.status(500).json({ message: "Server configuration error" });
    }

    // Generate JWT with appropriate expiry
    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { 
        expiresIn: "24h",
        algorithm: "HS256" 
      }
    );

    // Set secure HTTP-only cookie (recommended)
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // HTTPS only in production
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    // Log successful login
    console.log(`User logged in: ${user.username}`);

    // Return token and user info (without password)
    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ 
      message: "An error occurred during login" 
    });
  }
});

// Optional: Token refresh endpoint
router.post("/refresh", async (req, res) => {
  try {
    const token = req.cookies.auth_token || req.headers.authorization?.split(" ")[1];
    
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      ignoreExpiration: true, // Check if expired manually
    });

    // Check if token is about to expire (within 1 hour)
    const tokenExp = decoded.exp * 1000;
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    if (tokenExp - now > oneHour) {
      return res.json({ message: "Token still valid", token });
    }

    // Issue new token
    const newToken = jwt.sign(
      { id: decoded.id, username: decoded.username },
      process.env.JWT_SECRET,
      { expiresIn: "24h", algorithm: "HS256" }
    );

    res.json({ token: newToken });
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
});

module.exports = router;