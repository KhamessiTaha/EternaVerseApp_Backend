// utils/chronicle.js
//
// What a universe was, written down at the moment it stops being one.
//
// Everything here is already somewhere on the document - civilizations,
// legacies, anomalies, research - but scattered across arrays that get culled
// and rewritten as the simulation runs. `_cullCivilizations` keeps only the
// hundred most recent extinctions; anomalies get pruned. So a summary computed
// LATER is a summary of what happened to survive, not of what happened.
//
// This is taken once, at the end, and frozen. It's the record a run leaves
// behind - the thing that makes a universe worth having kept rather than a
// save file you delete.
//
// Pure over the universe document, so it unit-tests and the runner stays a
// thin caller.

const { codeForSeed } = require("./seedCode");

const round = (n, places = 2) => {
  const f = 10 ** places;
  return Math.round((n || 0) * f) / f;
};

/**
 * Summarise a finished universe. Safe to call on a partial document - every
 * field defaults - because it runs inside the simulation loop where an
 * exception would cost the player the whole tick.
 */
function buildChronicle(universe, endedAt = new Date()) {
  const cs = universe.currentState || {};
  const civs = universe.civilizations || [];
  const legacies = universe.legacies || [];

  // "Met" is the honest measure of a relationship: observed, or moved by
  // anything you did. A civ that rose and fell without you ever seeing it
  // isn't part of your story.
  const met = civs.filter((c) => c.observed || (c.relationship || 0) !== 0);
  const metLost = met.filter((c) => c.extinct);
  const rescued = civs.filter((c) => (c.rescues || 0) > 0);

  return {
    endedAt,
    endCondition: universe.endCondition || null,
    endReason: universe.endReason || null,

    // How far it got
    finalAgeGyr: round((cs.age || 0) / 1e9),
    galaxies: cs.galaxyCount || 0,
    stars: cs.starCount || 0,
    steps: universe.simStep || 0,

    // Who lived here
    civilizationsCreated: cs.civilizationsCreated || 0,
    civilizationsMet: met.length,
    civilizationsLost: metLost.length,
    civilizationsRescued: rescued.length,

    // What ascended - the only thing that was ever meant to outlast the
    // universe it happened in.
    ascended: legacies.map((l) => ({
      civId: l.civId,
      designation: l.designation || null,
      ageGyr: l.ageGyr || null,
      rescues: l.rescues || 0,
      uplifts: l.uplifts || 0,
    })),

    // What you did with your hands.
    //
    // Read from metrics, NOT by filtering universe.anomalies - which was the
    // bug that reported "anomalies contained: 0" to players who had contained
    // dozens. Two reasons that filter can never work:
    //
    //   1. autoCleanup() drops resolved anomalies older than five minutes once
    //      the array hits 200, and the cleanup route prunes on a timer too. So
    //      the filter only ever counted the last few minutes of a whole run.
    //   2. MINOR anomalies never enter universe.anomalies at all - they're
    //      chunk-seeded client-side and tracked by id in
    //      resolvedMinorAnomalies. They were never counted, at any point.
    //
    // metrics.anomaliesResolved is incremented by BOTH resolve paths
    // (anomalyGenerator.resolveAnomaly and minorAnomalies.applyMinorResolution)
    // and is monotonic, so it survives every cull.
    anomaliesResolved: universe.metrics?.anomaliesResolved || 0,
    interventions: universe.metrics?.playerInterventions || 0,
    researchEarned: universe.research?.totalEarned || 0,
    discoveries: universe.research?.discoveryCount || 0,

    // Enough identity to render a card without loading the whole universe
    name: universe.name || null,
    difficulty: universe.difficulty || null,
    doctrine: universe.doctrine || null,
    // The code goes ON the death card. That's what turns a screenshot into an
    // invitation: someone sees the image, types the code, plays the same
    // cosmos. `reproducible` is false for universes made before share codes,
    // where the code is display-only.
    ...(() => {
      const { code, reproducible } = codeForSeed(universe.seed);
      return { shareCode: code, shareCodeReproducible: reproducible };
    })(),
  };
}

module.exports = { buildChronicle };
