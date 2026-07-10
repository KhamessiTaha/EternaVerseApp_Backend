const express = require("express");
const verifyToken = require("../middleware/authMiddleware");
const User = require("../models/User");

const router = express.Router();

router.get("/profile", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/achievements", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("achievements");
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    res.json({ ok: true, achievements: user.achievements });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
