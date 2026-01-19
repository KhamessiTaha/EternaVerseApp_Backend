const jwt = require("jsonwebtoken");

const verifyToken = (req, res, next) => {
  const authHeader = req.header("Authorization");
  
  if (!authHeader) {
    return res.status(401).json({ message: "Access Denied - No token provided" });
  }

  try {
    // Remove "Bearer " prefix if it exists
    const token = authHeader.startsWith("Bearer ") 
      ? authHeader.slice(7) 
      : authHeader;
    
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    
    console.log("User authenticated:", verified); // Debug log
    
    next();
  } catch (err) {
    console.error("Token verification error:", err.message);
    res.status(400).json({ message: "Invalid Token" });
  }
};

module.exports = verifyToken;