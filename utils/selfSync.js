// utils/selfSync.js
//
// The warden's identity, merged.
//
// The Self lived entirely in localStorage under a GLOBAL key - so clearing
// cookies destroyed it, and two accounts on one browser shared one identity.
// Moving it to the account fixes both, but introduces the problem this file
// exists for: two devices can each hold progress the other has never seen, and
// a naive "last write wins" throws one of them away.
//
// So the server never overwrites. It MERGES, and it is the only place that
// does - the client sends its whole local state and adopts whatever comes
// back. One implementation, no mirrored-catalog drift.
//
// The fields split into two kinds, and the distinction is the whole safety
// argument:
//
//   CUMULATIVE  memories, insights, identities, bests, asked, ascensions.
//               Monotonic. Union/max is always safe.
//
//   CYCLE       recollection, affinity, bandPointer. These are INTERDEPENDENT:
//               wardenProgress.recoverOwed() computes
//               `bandsPassed(recollection) - bandPointer`, so taking a high
//               recollection from one device and a low bandPointer from
//               another re-awards Memories the player has already read. They
//               move together, from whichever record is further along, or not
//               at all.
//
// The one direction this can drift is harmless: a player may end with more
// recovered Memories than bands consumed. pickMemory() already skips anything
// recovered, so that never re-owes - it just means the next band is free.

const SCHEMA_VERSION = 1;

const AFFINITY_KEYS = ["observer", "gardener", "wanderer", "unmaker"];

function emptyAffinity() {
  return AFFINITY_KEYS.reduce((a, k) => ((a[k] = 0), a), {});
}

function defaults() {
  return {
    schemaVersion: SCHEMA_VERSION,
    ascensions: 0,
    recollection: 0,
    affinity: emptyAffinity(),
    bandPointer: 0,
    memoriesRecovered: [],
    insightsCompleted: [],
    identitiesRealized: [],
    anamnesisSeen: false,
    rapport: 0,
    asked: [],
    bests: {},
    // Morphology-reading record per family: { elliptical: {calls, correct} }.
    // Cumulative: it records what the PLAYER learned, so it is summed across
    // devices rather than taken from a winner.
    classify: {},
    updatedAt: null,
  };
}

const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Union preserving first-seen order, so a player's history reads in sequence. */
function union(a, b) {
  const seen = new Set();
  const out = [];
  for (const v of [...arr(a), ...arr(b)]) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * How far along a record is. Compared lexicographically to decide which
 * record's CYCLE state survives a merge.
 *
 * Identities realized first because they're the rarest and most expensive
 * thing in the game; recovered Memories next; raw Recollection last, since
 * it resets to zero on every Revelation and so is the weakest signal of all.
 */
function progressRank(s) {
  return [
    arr(s?.identitiesRealized).length,
    arr(s?.memoriesRecovered).length,
    num(s?.recollection),
  ];
}

function isFurtherAlong(a, b) {
  const ra = progressRank(a);
  const rb = progressRank(b);
  for (let i = 0; i < ra.length; i++) {
    if (ra[i] !== rb[i]) return ra[i] > rb[i];
  }
  return false; // identical - keep the incumbent
}

/** Coerce anything into a valid Self, dropping junk rather than throwing. */
function normalize(input) {
  const d = defaults();
  if (!input || typeof input !== "object") return d;

  const affinity = emptyAffinity();
  for (const k of AFFINITY_KEYS) affinity[k] = Math.max(0, num(input.affinity?.[k]));

  const bests = {};
  if (input.bests && typeof input.bests === "object") {
    for (const [k, v] of Object.entries(input.bests)) {
      const n = num(v, null);
      if (n !== null && n >= 0) bests[k] = Math.min(100, n);
    }
  }

  const classify = {};
  if (input.classify && typeof input.classify === "object") {
    for (const [k, v] of Object.entries(input.classify)) {
      const calls = Math.max(0, Math.floor(num(v?.calls)));
      // correct can never exceed calls, or a client could certify itself.
      const correct = Math.min(calls, Math.max(0, Math.floor(num(v?.correct))));
      if (calls > 0) classify[k] = { calls, correct };
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    ascensions: Math.max(0, Math.floor(num(input.ascensions))),
    recollection: Math.max(0, num(input.recollection)),
    affinity,
    bandPointer: Math.max(0, Math.floor(num(input.bandPointer))),
    memoriesRecovered: arr(input.memoriesRecovered),
    insightsCompleted: arr(input.insightsCompleted),
    identitiesRealized: arr(input.identitiesRealized),
    anamnesisSeen: !!input.anamnesisSeen,
    rapport: num(input.rapport),
    asked: arr(input.asked),
    bests,
    classify,
    updatedAt: input.updatedAt || null,
  };
}

/**
 * Merge two Selves. Order-independent for cumulative fields; cycle state comes
 * from whichever side is further along, as one atomic unit.
 *
 * Either side may be null (first sync, or a device with nothing yet).
 */
function mergeSelf(current, incoming, now = new Date()) {
  const a = normalize(current);
  const b = normalize(incoming);

  // Cycle state travels together or not at all.
  const winner = isFurtherAlong(b, a) ? b : a;

  const bests = { ...a.bests };
  for (const [k, v] of Object.entries(b.bests)) {
    bests[k] = Math.max(num(bests[k], 0), v);
  }

  // Certification takes the FURTHER-ALONG record per family, not the sum.
  // Summing would double-count the calls both devices already agree on: sync
  // down, scan twelve galaxies, sync up, and the merge would read twenty-four.
  // Per family, more calls means the more complete history.
  const classify = { ...a.classify };
  for (const [k, v] of Object.entries(b.classify)) {
    const mine = classify[k];
    if (!mine || v.calls > mine.calls) classify[k] = { ...v };
  }

  return {
    schemaVersion: SCHEMA_VERSION,

    // Cumulative - union/max, safe in any order.
    ascensions: Math.max(a.ascensions, b.ascensions),
    memoriesRecovered: union(a.memoriesRecovered, b.memoriesRecovered),
    insightsCompleted: union(a.insightsCompleted, b.insightsCompleted),
    identitiesRealized: union(a.identitiesRealized, b.identitiesRealized),
    anamnesisSeen: a.anamnesisSeen || b.anamnesisSeen,
    asked: union(a.asked, b.asked),
    bests,
    classify,
    // Generous on purpose: rapport is a relationship, and the bias everywhere
    // in this file is "never take something away from the player".
    rapport: Math.max(a.rapport, b.rapport),

    // Cycle - atomic.
    recollection: winner.recollection,
    affinity: { ...winner.affinity },
    bandPointer: winner.bandPointer,

    updatedAt: now,
  };
}

module.exports = {
  SCHEMA_VERSION,
  AFFINITY_KEYS,
  defaults,
  emptyAffinity,
  normalize,
  mergeSelf,
  progressRank,
  isFurtherAlong,
};
