// utils/materials.js
//
// What the universe has actually forged, and when - server-authoritative.
//
// Mirrors the frontend's src/components/game/world/materials.js the same way
// PERFORMANCE_TIERS mirror GRADE_TIERS: that copy drives display and lets the
// client predict a harvest; THIS copy decides what is actually granted.
//
// Unlike the classify-before-scan bonus - which can't be verified without
// regenerating procedural world objects - these gates are genuinely checkable
// here, because the server owns currentState. A client claiming gold from a
// universe that has never merged a neutron star gets nothing, and doesn't need
// to be trusted not to try.
//
// The rule: you cannot harvest gold in a young cosmos, because the cosmos
// hasn't made any yet.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const SOURCES = {
  nebula: "nebula",
  star: "star",
  supernova: "supernova",
  merger: "merger",
  quasar: "quasar",
};

const MATERIALS = {
  hydrogen:   { tier: 0, sources: ["nebula"],            gate: () => true },
  helium:     { tier: 0, sources: ["nebula", "star"],    gate: () => true },
  carbon:     { tier: 1, sources: ["star", "nebula"],    gate: (cs) => num(cs?.stellarGenerations) >= 1 },
  oxygen:     { tier: 1, sources: ["star", "nebula"],    gate: (cs) => num(cs?.stellarGenerations) >= 1 },
  iron:       { tier: 2, sources: ["supernova"],         gate: (cs) => num(cs?.stellarGenerations) >= 2 },
  gold:       { tier: 3, sources: ["merger"],            gate: (cs) => num(cs?.metallicity) >= 0.3 },
  platinum:   { tier: 3, sources: ["merger"],            gate: (cs) => num(cs?.metallicity) >= 0.4 },
  uranium:    { tier: 4, sources: ["merger"],            gate: (cs) => num(cs?.metallicity) >= 0.6 },
  degenerate: { tier: 5, sources: ["merger"],            gate: (cs) => num(cs?.stellarGenerations) >= 5 },
  hawking:    { tier: 5, sources: ["quasar"],            gate: (cs) => num(cs?.blackHoleCount) > 0 },
};

const MATERIAL_IDS = Object.keys(MATERIALS);
const BASE_YIELD = { 0: 4, 1: 3, 2: 2, 3: 1, 4: 1, 5: 1 };

// A harvest is worth at most a flawless grade; anything beyond that is a
// tampered report, clamped the same way the survey streak is.
const MAX_GRADE = 2.6;

function isAvailable(id, cs) {
  const m = MATERIALS[id];
  if (!m) return false;
  try { return !!m.gate(cs); } catch { return false; }
}

function harvestableFrom(source, cs) {
  return MATERIAL_IDS.filter((id) => MATERIALS[id].sources.includes(source) && isAvailable(id, cs));
}

/**
 * Roll and grant one harvest. Mutates universe.materials; caller saves.
 *
 * Returns { ok, id, amount, materials } or { ok: false, reason } - an empty
 * source is a legitimate outcome (the universe hasn't forged anything of that
 * kind yet), not an error.
 */
function grantHarvest(universe, source, grade = 1, rng = Math.random) {
  if (!SOURCES[source]) return { ok: false, reason: "Unknown harvest source" };

  const cs = universe?.currentState || {};
  const pool = harvestableFrom(source, cs);
  if (pool.length === 0) {
    return { ok: false, reason: "This universe has not forged anything of that kind yet", empty: true };
  }

  // Rarer materials are rarer within their own source.
  const weights = pool.map((id) => 1 / (1 + MATERIALS[id].tier));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  let picked = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { picked = pool[i]; break; }
  }

  const g = Math.max(0.2, Math.min(MAX_GRADE, num(grade) || 1));
  const amount = Math.max(1, Math.round((BASE_YIELD[MATERIALS[picked].tier] ?? 1) * g));

  if (!universe.materials || typeof universe.materials !== "object") universe.materials = {};
  universe.materials[picked] = (num(universe.materials[picked]) || 0) + amount;

  return { ok: true, id: picked, amount, materials: universe.materials };
}

module.exports = {
  SOURCES, MATERIALS, MATERIAL_IDS, MAX_GRADE,
  isAvailable, harvestableFrom, grantHarvest,
};
