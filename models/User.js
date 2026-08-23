const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  // Dev/test privileges. Deliberately NOT settable through any API route -
  // the only way to grant it is editing the document directly in MongoDB.
  isAdmin: { type: Boolean, default: false },
  // Anonymous demo account (POST /auth/guest). Full-featured while active;
  // POST /auth/claim upgrades it in place to a real account (same _id, so the
  // guest's universes are simply kept - no reassignment).
  isGuest: { type: Boolean, default: false },
  // Account-wide achievements, unlocked by evaluating a universe's state
  // (see utils/achievements.js) - persist across all of a player's universes.
  achievements: {
    type: [{ id: { type: String, required: true }, unlockedAt: { type: Date, default: Date.now } }],
    default: [],
  },
  // Every species that has reached the stars under this player, across every
  // universe (see utils/pantheon.js). A legacy is recorded on the universe
  // where it happened, so without this copy the one thing the game calls
  // "immortal" would die with that universe. Same lifetime as achievements.
  pantheon: {
    type: [{
      civId: { type: String, required: true },
      designation: { type: String, default: null },
      ascendedAt: { type: Date, default: Date.now },
      ageGyr: { type: String, default: null },
      uplifts: { type: Number, default: 0 },
      rescues: { type: Number, default: 0 },
      pacifies: { type: Number, default: 0 },
      shepherdedFor: { type: Number, default: 0 },
      // Where they rose - a civId is only unique within its own universe.
      universeId: { type: String, default: null },
      universeName: { type: String, default: null },
    }],
    default: [],
  },
  // Account-wide ship loadout (see utils/hullCatalog.js) - cosmetic only,
  // carries across every universe. Validated server-side against the
  // player's unlocked achievements on every write, never trust the client.
  hull: { type: String, default: "interceptor" },
  shipColor: { type: String, default: "#dfa73f" },
}, { timestamps: true });

const User = mongoose.model("User", userSchema);
module.exports = User;
