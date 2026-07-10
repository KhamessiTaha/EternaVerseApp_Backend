// utils/achievements.js
//
// Account-wide achievements. Each entry is a pure predicate over a single
// universe's state - no new tracking hooks, everything reads fields the sim
// already persists (milestones, metrics, research, civilizations, missions,
// upgrades). Evaluated opportunistically after any route that could move
// the needle (simulate, contact, claim-mission, upgrade, discoveries);
// cheap and idempotent, so over-calling it is safe.

const CATALOG = [
  // Cosmic milestones - direct mirror of MilestonesSchema
  { id: "genesis", tier: "bronze", title: "Genesis", description: "Witness the formation of the first galaxy.",
    check: (u) => !!u.milestones?.firstGalaxy },
  { id: "first-light", tier: "bronze", title: "First Light", description: "Witness the ignition of the first star.",
    check: (u) => !!u.milestones?.firstStar },
  { id: "cradle-of-life", tier: "bronze", title: "Cradle of Life", description: "Witness the emergence of life.",
    check: (u) => !!u.milestones?.firstLife },
  { id: "not-alone", tier: "silver", title: "Not Alone", description: "Witness the rise of the first civilization.",
    check: (u) => !!u.milestones?.firstCivilization },
  { id: "stellar-age", tier: "bronze", title: "Stellar Age", description: "Reach a Population I stellar era.",
    check: (u) => !!u.milestones?.stellarPopulationI },
  { id: "cambrian-explosion", tier: "silver", title: "Cambrian Explosion", description: "Reach a complex-life era.",
    check: (u) => !!u.milestones?.complexLifeEra },
  { id: "singularity", tier: "gold", title: "Singularity", description: "Witness a technological singularity.",
    check: (u) => !!u.milestones?.technologicalSingularity },
  { id: "great-filter", tier: "gold", title: "The Great Filter", description: "Witness a civilization pass the great filter.",
    check: (u) => !!u.milestones?.greatFilter },
  { id: "ascension", tier: "platinum", title: "Ascension", description: "Witness a civilization transcend.",
    check: (u) => !!u.milestones?.transcendence },

  // First Contact
  { id: "diplomat", tier: "silver", title: "Diplomat", description: "Observe 3 civilizations in a single universe.",
    check: (u) => (u.civilizations || []).filter((c) => c.observed).length >= 3 },
  { id: "benefactor", tier: "silver", title: "Benefactor", description: "Successfully uplift civilizations 3 times.",
    check: (u) => (u.civilizations || []).reduce((s, c) => s + (c.uplifts || 0), 0) >= 3 },
  { id: "peacemaker", tier: "silver", title: "Peacemaker", description: "Pacify civilizations 3 times.",
    check: (u) => (u.civilizations || []).reduce((s, c) => s + (c.pacifies || 0), 0) >= 3 },

  // Exploration / research
  { id: "archivist", tier: "bronze", title: "Archivist", description: "Catalog 25 discoveries in a single universe.",
    check: (u) => (u.research?.discoveryCount || 0) >= 25 },
  { id: "taxonomist", tier: "gold", title: "Taxonomist", description: "Discover 8 distinct object classes.",
    check: (u) => (u.research?.classesDiscovered || []).length >= 8 },
  { id: "anomaly-hunter", tier: "silver", title: "Anomaly Hunter", description: "Resolve 10 anomalies in a single universe.",
    check: (u) => (u.metrics?.anomaliesResolved || 0) >= 10 },

  // Progression
  { id: "well-equipped", tier: "gold", title: "Well Equipped", description: "Max every ship upgrade track.",
    check: (u) => ["thrusters", "boostReactor", "scanner", "containment"].every((t) => (u.upgrades?.[t] || 0) >= 3) },
  { id: "on-mission", tier: "bronze", title: "On Mission", description: "Claim 5 objectives.",
    check: (u) => (u.missions || []).filter((m) => m.status === "claimed").length >= 5 },
  { id: "veteran-observer", tier: "silver", title: "Veteran Observer", description: "Guide a universe past 10 billion years.",
    check: (u) => (u.currentState?.age || 0) >= 10e9 },
];

function evaluate(universe) {
  return new Set(CATALOG.filter((entry) => {
    try {
      return entry.check(universe);
    } catch {
      return false;
    }
  }).map((e) => e.id));
}

/**
 * Diff a universe's satisfied achievements against what the user already
 * has, append any new ones, and save. Returns the newly-unlocked catalog
 * entries (empty array = nothing new, no write performed).
 */
async function awardAchievements(User, userId, universe) {
  const user = await User.findById(userId).select("achievements");
  if (!user) return [];

  const owned = new Set(user.achievements.map((a) => a.id));
  const satisfied = evaluate(universe);
  const newIds = [...satisfied].filter((id) => !owned.has(id));
  if (newIds.length === 0) return [];

  user.achievements.push(...newIds.map((id) => ({ id, unlockedAt: new Date() })));
  await user.save();

  return CATALOG.filter((e) => newIds.includes(e.id));
}

module.exports = { CATALOG, evaluate, awardAchievements };
