const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  // Dev/test privileges. Deliberately NOT settable through any API route -
  // the only way to grant it is editing the document directly in MongoDB.
  isAdmin: { type: Boolean, default: false },
  // Account-wide achievements, unlocked by evaluating a universe's state
  // (see utils/achievements.js) - persist across all of a player's universes.
  achievements: {
    type: [{ id: { type: String, required: true }, unlockedAt: { type: Date, default: Date.now } }],
    default: [],
  },
}, { timestamps: true });

const User = mongoose.model("User", userSchema);
module.exports = User;
