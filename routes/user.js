const express = require("express");
const verifyToken = require("../middleware/authMiddleware");
const User = require("../models/User");
const { unlockedHullIds, validateLoadout } = require("../utils/hullCatalog");

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

// Current hull/color selection + which hulls the account has unlocked so
// far (derived live from achievements, not stored separately).
router.get("/loadout", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("hull shipColor achievements");
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    res.json({
      ok: true,
      hull: user.hull,
      shipColor: user.shipColor,
      unlockedHulls: unlockedHullIds(user),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Change hull/color. Re-validated against the user's actual achievements on
// every write - the client's unlocked-hull list is a display hint, never
// the authorization.
router.put("/loadout", verifyToken, async (req, res) => {
  try {
    const { hull, shipColor } = req.body;
    const user = await User.findById(req.user.id).select("hull shipColor achievements");
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const check = validateLoadout(user, hull, shipColor);
    if (!check.ok) return res.status(400).json({ ok: false, error: check.reason });

    user.hull = hull;
    user.shipColor = shipColor;
    await user.save();

    res.json({ ok: true, hull: user.hull, shipColor: user.shipColor });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
