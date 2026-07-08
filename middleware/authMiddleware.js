const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
  const authHeader = req.header("Authorization");
  
  if (!authHeader) {
    return res.status(401).json({ message: "Access Denied: No token provided" });
  }

  // Extract token from "Bearer <token>" format
  const token = authHeader.startsWith("Bearer ") 
    ? authHeader.slice(7) 
    : authHeader;

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    console.error("Token verification failed:", err.message);
    // 401 (not 400): invalid/expired tokens are an auth failure. The frontend
    // treats 401/403 as "session over, log out" - a 400 here would either be
    // ignored or force the client to conflate validation errors with logout.
    res.status(401).json({ message: "Invalid Token" });
  }
};

module.exports = verifyToken;