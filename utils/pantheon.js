// utils/pantheon.js
//
// Every species that has ever reached the stars under this player, across
// every universe they have ever kept.
//
// A legacy is recorded on the universe where it happened (physicsEngine
// _recordLegacy), which means it dies with that universe - the one thing in
// the game explicitly described as "immortal" was the least permanent thing
// in it. The pantheon is the account-wide copy, alongside achievements, so an
// ascension outlives the cosmos that produced it.
//
// Pure over plain arrays: the routes own the User document, this owns the
// rules about what belongs in a pantheon and what's already there.

// A civ id is only unique WITHIN a universe, so identity is the pair.
const keyOf = (entry) => `${entry.universeId}:${entry.civId}`;

/**
 * The legacies on this universe that aren't in the pantheon yet, shaped for
 * storage. `universe` needs _id, name and legacies.
 */
function newLegaciesFor(universe, pantheon = []) {
  const have = new Set((pantheon || []).map(keyOf));
  const universeId = universe?._id?.toString?.() ?? String(universe?._id ?? "");
  const universeName = universe?.name || null;

  return (universe?.legacies || [])
    .map((l) => ({
      civId: l.civId,
      designation: l.designation || null,
      ascendedAt: l.ascendedAt || new Date(),
      ageGyr: l.ageGyr || null,
      uplifts: l.uplifts || 0,
      rescues: l.rescues || 0,
      pacifies: l.pacifies || 0,
      shepherdedFor: l.shepherdedFor || 0,
      universeId,
      universeName,
    }))
    .filter((entry) => entry.civId && !have.has(keyOf(entry)));
}

/**
 * Fold a universe's legacies into a pantheon. Returns { pantheon, added } with
 * a NEW array when anything changed, so a caller can skip the write when
 * nothing did - this runs on every simulation tick.
 */
function syncPantheon(universe, pantheon = []) {
  const added = newLegaciesFor(universe, pantheon);
  if (added.length === 0) return { pantheon, added };
  return { pantheon: [...(pantheon || []), ...added], added };
}

module.exports = { newLegaciesFor, syncPantheon };
