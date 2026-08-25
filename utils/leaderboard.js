// utils/leaderboard.js
//
// Same cosmos, different wardens.
//
// A GLOBAL leaderboard would be wrong for this game. "Highest final age" across
// all universes rewards leaving a tab open, and comparing a Beginner 24-Gyr run
// against an Advanced 12-Gyr one compares nothing at all.
//
// Per-SEED is a fair fight: identical starting conditions, identical physics,
// identical everything except what the warden did. It's also the exact sentence
// a share code makes possible - "Universe KX7-2291, I got them to Type II
// before the collapse, beat that."
//
// WHAT COUNTS AS BETTER, in order:
//
//   1. ascensions        species you carried to Type III - the actual win
//   2. peoples saved     worlds you personally kept alive
//   3. final age         how long you held it together
//
// Deliberately in that order. Final age is last because it's the one you can
// get by doing nothing, and a ladder that rewards idling above shepherding
// would be teaching the wrong game.

/**
 * A run, from a finished universe's frozen chronicle.
 *
 * Returns null when the universe has no chronicle (it hasn't ended) or its
 * code can't rebuild it - a legacy universe's code identifies it but generates
 * a different cosmos, so its runs must never pollute that code's board.
 */
function buildRunEntry(universe, user) {
  const c = universe?.chronicle;
  if (!c || !c.shareCode) return null;
  if (c.shareCodeReproducible === false) return null;

  return {
    shareCode: c.shareCode,
    universeId: universe._id?.toString?.() ?? String(universe._id ?? ""),
    userId: user?._id?.toString?.() ?? String(user?._id ?? ""),
    username: user?.username || "a warden",
    universeName: c.name || universe.name || null,
    difficulty: c.difficulty || null,

    // The ranked figures.
    ascensions: (c.ascended || []).length,
    rescued: c.civilizationsRescued || 0,
    finalAgeGyr: c.finalAgeGyr || 0,

    // Context for the row.
    endCondition: c.endCondition || null,
    lost: c.civilizationsLost || 0,
    endedAt: c.endedAt || new Date(),
  };
}

/** Lexicographic: ascensions, then rescues, then age. Higher is better. */
function compareRuns(a, b) {
  return (
    (b.ascensions || 0) - (a.ascensions || 0) ||
    (b.rescued || 0) - (a.rescued || 0) ||
    (b.finalAgeGyr || 0) - (a.finalAgeGyr || 0) ||
    // Fully deterministic tiebreak, so a board never reshuffles between reads.
    new Date(a.endedAt) - new Date(b.endedAt)
  );
}

/** Best first. Does not mutate the input. */
function rankRuns(runs) {
  return [...(runs || [])].sort(compareRuns);
}

/** 1-based place of a universe on its own board, or null if it isn't there. */
function placeOf(runs, universeId) {
  const ranked = rankRuns(runs);
  const i = ranked.findIndex((r) => r.universeId === String(universeId));
  return i === -1 ? null : i + 1;
}

/** "3rd of 11" - the line the player actually reads. */
function ordinal(n) {
  if (!Number.isFinite(n) || n < 1) return null;
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

module.exports = { buildRunEntry, compareRuns, rankRuns, placeOf, ordinal };
