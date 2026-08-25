// utils/artifacts.js
//
// The only things the player MAKES - server-authoritative.
//
// Mirrors the frontend's content/artifacts.js the way recipes mirror their
// client copy: that one previews affordability, this one decides what is
// actually spent and what actually gets placed.
//
// Artifacts live on the UNIVERSE (they're in the world) and are ALSO copied to
// the account when placed, so they survive the cosmos that held them. That
// second copy is the whole emotional point: a chronicle records what happened,
// an artifact is a thing you made, and it gets named in every universe you
// play afterwards.

const { spend } = require("./recipes");

const ARTIFACTS = {
  beacon:   { label: "Beacon",     cost: { iron: 6, carbon: 4 } },
  monument: { label: "Monument",   cost: { iron: 12, gold: 2 } },
  vault:    { label: "Seed Vault", cost: { carbon: 10, oxygen: 8, uranium: 1 } },
};

const ARTIFACT_IDS = Object.keys(ARTIFACTS);

// A universe is a place, not a warehouse. Without a cap a player could carpet
// the map, and an artifact that is everywhere means nothing anywhere.
const MAX_PER_UNIVERSE = 24;
const MAX_NOTE = 120;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function canBuild(materials, id) {
  const a = ARTIFACTS[id];
  if (!a) return { ok: false, reason: "Unknown artifact" };
  const have = materials || {};
  const missing = {};
  for (const [mat, need] of Object.entries(a.cost)) {
    const short = need - num(have[mat]);
    if (short > 0) missing[mat] = short;
  }
  if (Object.keys(missing).length) {
    const shortfall = Object.entries(missing).map(([m, n]) => `${n} ${m}`).join(", ");
    return { ok: false, reason: `${a.label} needs ${shortfall}`, missing };
  }
  return { ok: true };
}

/**
 * Place an artifact. Mutates universe.materials and universe.artifacts;
 * caller saves. Returns { ok, artifact } or { ok: false, reason }.
 */
function placeArtifact(universe, { kind, x, y, scale, path, note, civId }, now = new Date()) {
  const def = ARTIFACTS[kind];
  if (!def) return { ok: false, reason: "Unknown artifact" };
  if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
    return { ok: false, reason: "Artifacts need a place to stand" };
  }

  if (!Array.isArray(universe.artifacts)) universe.artifacts = [];
  if (universe.artifacts.length >= MAX_PER_UNIVERSE) {
    return { ok: false, reason: `This universe already holds ${MAX_PER_UNIVERSE} of your works` };
  }

  const afford = canBuild(universe.materials, kind);
  if (!afford.ok) return afford;

  universe.materials = spend(universe.materials, def.cost);

  const artifact = {
    id: `art_${now.getTime()}_${Math.floor(Math.random() * 1e5)}`,
    kind,
    label: def.label,
    x: Number(x),
    y: Number(y),
    // Cosmic Scales: an artifact belongs to the scale and descent path it was
    // planted at, or it would render inside a star system it was never in.
    scale: typeof scale === "string" ? scale : "galactic",
    path: Array.isArray(path) ? path.slice(0, 4) : [],
    civId: typeof civId === "string" ? civId : null,
    note: typeof note === "string" ? note.slice(0, MAX_NOTE) : null,
    placedAt: now,
  };
  universe.artifacts.push(artifact);

  return { ok: true, artifact };
}

/**
 * The account-wide copy, so a work outlives the universe that held it.
 * Returns { works, added } - a NEW array only when something changed, so the
 * caller can skip the write.
 */
function recordWork(works, artifact, universe) {
  const list = Array.isArray(works) ? works : [];
  if (list.some((w) => w.id === artifact.id)) return { works: list, added: null };

  const entry = {
    id: artifact.id,
    kind: artifact.kind,
    label: artifact.label,
    note: artifact.note || null,
    placedAt: artifact.placedAt,
    universeId: universe?._id?.toString?.() ?? String(universe?._id ?? ""),
    universeName: universe?.name || null,
  };
  return { works: [...list, entry], added: entry };
}

module.exports = {
  ARTIFACTS, ARTIFACT_IDS, MAX_PER_UNIVERSE, MAX_NOTE,
  canBuild, placeArtifact, recordWork,
};
