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
  const anomalies = universe.anomalies || [];

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

    // What you did with your hands
    anomaliesResolved: anomalies.filter((a) => a.resolved).length,
    interventions: universe.metrics?.playerInterventions || 0,
    researchEarned: universe.research?.totalEarned || 0,
    discoveries: universe.research?.discoveryCount || 0,

    // Enough identity to render a card without loading the whole universe
    name: universe.name || null,
    difficulty: universe.difficulty || null,
    doctrine: universe.doctrine || null,
  };
}

module.exports = { buildChronicle };
