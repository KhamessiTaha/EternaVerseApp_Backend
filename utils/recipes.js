// utils/recipes.js
//
// What a module is made OF, as opposed to what it costs to design.
//
// RP researches; matter builds. Both currencies stay meaningful:
//
//   Mk 1  RP only            - early game is exactly as it was
//   Mk 2  RP + common matter  - a reason to go somewhere specific
//   Mk 3  RP + exotic matter  - gated on what the universe has forged
//
// That last row is the whole point of the materials system landing in the
// place players care about most: YOU CANNOT MAX YOUR SHIP UNTIL THE UNIVERSE
// HAS MADE THE ATOMS. A young cosmos physically cannot produce a Mk 3 Scanner,
// because it has no gold in it yet.
//
// Note this deliberately does NOT replace the RP costs in upgradeCatalog.
// Upgrades are RP's only sink; removing it would leave research points with
// nothing to buy, which makes the abundance problem worse rather than better.
//
// Mirrored by the frontend's content/recipes.js for display. This copy is
// authoritative - it decides what is actually spent.

// requirements[n] = what going from level n to level n+1 costs in matter.
// null means "no matter required" (Mk 1 stays pure research).
//
// The pairings are real where reality was interesting enough:
// gold and platinum go into the Scanner because that is genuinely what
// precision optics are coated with.
const RECIPES = {
  thrusters: [
    null,
    { iron: 4 },
    { iron: 8, degenerate: 1 },
  ],
  boostReactor: [
    null,
    { carbon: 4, oxygen: 2 },
    { iron: 6, hawking: 1 },
  ],
  scanner: [
    null,
    { carbon: 5 },
    { gold: 2, platinum: 1 },
  ],
  containment: [
    null,
    { iron: 5, oxygen: 3 },
    { uranium: 2, degenerate: 1 },
  ],
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** What the next level of this track needs in matter, or null. */
function requirementFor(track, level) {
  return RECIPES[track]?.[level] ?? null;
}

/**
 * Can this universe's stock cover a requirement?
 * Returns { ok } or { ok: false, missing: { id: shortfall } }.
 */
function canAfford(materials, requirement) {
  if (!requirement) return { ok: true };
  const have = materials || {};
  const missing = {};
  for (const [id, need] of Object.entries(requirement)) {
    const short = need - num(have[id]);
    if (short > 0) missing[id] = short;
  }
  return Object.keys(missing).length ? { ok: false, missing } : { ok: true };
}

/** Deduct a requirement. Caller has already checked canAfford. */
function spend(materials, requirement) {
  if (!requirement) return materials || {};
  const out = { ...(materials || {}) };
  for (const [id, need] of Object.entries(requirement)) {
    out[id] = Math.max(0, num(out[id]) - need);
  }
  return out;
}

module.exports = { RECIPES, requirementFor, canAfford, spend };
