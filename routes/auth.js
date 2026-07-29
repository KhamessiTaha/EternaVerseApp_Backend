const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const verifyToken = require("../middleware/authMiddleware");

const router = express.Router();

const signToken = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "24h" });

router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create new user
    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(400).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid password" });

    // Generate JWT Token. isAdmin in the response is a UI hint only (shows
    // the dev panel) - actual authorization is re-checked against the DB on
    // every dev request by adminMiddleware.
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, userId: user._id, username: user.username, isAdmin: !!user.isAdmin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Anonymous demo session: mint a throwaway guest account + real JWT, so the
// player can play the full game (server-authoritative and all) with zero
// signup friction. No email/password to remember - claim later to keep it.
router.post("/guest", async (req, res) => {
  try {
    const suffix = crypto.randomBytes(6).toString("hex");
    const randomPass = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);
    const guest = new User({
      username: `wanderer_${suffix}`,
      email: `guest_${suffix}@guest.eternaverse`,
      password: randomPass,
      isGuest: true,
    });
    await guest.save();

    return res.status(201).json({
      token: signToken(guest),
      userId: guest._id,
      username: guest.username,
      isAdmin: false,
      isGuest: true,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Claim a guest account: upgrade it in place to a real, credentialed account.
// Same _id, so every universe the guest created is simply kept. Requires the
// guest's own token.
router.post("/claim", verifyToken, async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ message: "Username, email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "Account not found" });
    if (!user.isGuest) return res.status(400).json({ message: "This account is already registered" });

    // Reject credentials already taken by a DIFFERENT account.
    const clash = await User.findOne({
      $and: [{ _id: { $ne: user._id } }, { $or: [{ email }, { username }] }],
    }).select("_id");
    if (clash) return res.status(409).json({ message: "That username or email is already taken" });

    user.username = username.trim();
    user.email = email.trim();
    user.password = await bcrypt.hash(password, 10);
    user.isGuest = false;
    await user.save();

    return res.json({
      token: signToken(user),
      userId: user._id,
      username: user.username,
      isAdmin: !!user.isAdmin,
      isGuest: false,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
