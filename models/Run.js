const mongoose = require("mongoose");

// One finished universe, on its seed's board.
//
// Separate from Universe on purpose: a run is a small, immutable record that
// gets read by everyone who plays that code, while a Universe document is
// large, mutable and private to its owner. Querying every universe by seed to
// build a board would mean loading megabytes of anomalies and civilizations to
// show six numbers.
//
// See utils/leaderboard.js for what counts as a better run, and why age ranks
// last.
const runSchema = new mongoose.Schema({
  // The board this row belongs to. Only reproducible codes get here - a
  // legacy code identifies a universe but generates a different cosmos, so
  // those runs would be ranking people who never played the same game.
  shareCode: { type: String, required: true, index: true },

  // One row per universe. A universe ends exactly once, so this is also what
  // makes recording idempotent if the end is ever processed twice.
  universeId: { type: String, required: true, unique: true },

  userId: { type: String, required: true },
  username: { type: String, default: "a warden" },
  universeName: { type: String, default: null },
  difficulty: { type: String, default: null },

  // Ranked, in this order.
  ascensions: { type: Number, default: 0 },
  rescued: { type: Number, default: 0 },
  finalAgeGyr: { type: Number, default: 0 },

  // Context for the row.
  endCondition: { type: String, default: null },
  lost: { type: Number, default: 0 },
  endedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// The only query this collection serves: one board, best first.
runSchema.index({ shareCode: 1, ascensions: -1, rescued: -1, finalAgeGyr: -1 });

module.exports = mongoose.model("Run", runSchema);
