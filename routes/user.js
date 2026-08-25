const express = require("express");
const verifyToken = require("../middleware/authMiddleware");
const User = require("../models/User");
const { unlockedHullIds, validateLoadout } = require("../utils/hullCatalog");
const { mergeSelf, defaults } = require("../utils/selfSync");

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

// The Self: the warden's cross-universe identity, account-wide.
//
// GET returns the canonical record (null-safe: a new account gets defaults).
router.get("/self", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("self");
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });
    res.json({ ok: true, self: user.self || defaults() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PUT merges the client's whole local Self into the account's and returns the
 * canonical result, which the client then adopts.
 *
 * MERGE, never overwrite: two devices can each hold progress the other has
 * never seen, and last-write-wins would throw one away. selfSync.mergeSelf
 * owns those rules - see the long comment there for why cycle state has to
 * move as one unit.
 */
router.put("/self", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("self");
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const merged = mergeSelf(user.self, req.body?.self, new Date());
    user.self = merged;
    user.markModified("self");
    await user.save();

    res.json({ ok: true, self: merged });
  } catch (err) {
    console.error("Self sync failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Everything this player has BUILT, across every universe. Universes die;
// works don't - this is what lets the Curator name them somewhere new.
router.get("/works", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("works");
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });
    const works = [...(user.works || [])].sort(
      (a, b) => new Date(b.placedAt) - new Date(a.placedAt)
    );
    res.json({ ok: true, works });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Every species that has reached the stars under this player, across every
// universe they have ever kept (utils/pantheon.js). Newest first - the most
// recent ascension is the one they'll want to see.
router.get("/pantheon", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("pantheon");
    if (!user) return res.status(404).json({ ok: false, error: "User not found" });

    const pantheon = [...(user.pantheon || [])].sort(
      (a, b) => new Date(b.ascendedAt) - new Date(a.ascendedAt)
    );
    res.json({ ok: true, pantheon });
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
