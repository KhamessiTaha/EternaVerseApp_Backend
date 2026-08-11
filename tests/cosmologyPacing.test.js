// tests/cosmologyPacing.test.js
//
// The pacing harness: runs a REAL universe through the real simulation loop
// and asserts the calibration target actually holds - ~400 steps from Big Bang
// to a Type III Ascension, with every state variable behaving physically along
// the way.
//
// This exists because the previous constants were never checked against the
// number of steps a player experiences. Each assertion below corresponds to a
// bug that shipped: anomalies that never spawned, metallicity pinned at 100%,
// energy frozen at 100%, 500 civilizations appearing at once, and an Ascension
// that needed tens of thousands of steps.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { advanceUniverse } = require("../utils/simulationRunner");
const AnomalyGenerator = require("../utils/anomalyGenerator");
const COSMO = require("../utils/cosmologyConfig");

function makeUniverse(difficulty = "Intermediate") {
  return {
    _id: { toString: () => "u-pacing" },
    seed: "pacing-seed",
    difficulty,
    constants: {},
    initialConditions: { initialTemperature: 2.725 },
    currentState: {
      age: 0, _scaleFactor: 1, expansionRate: 67.4, temperature: 2.725,
      entropy: 0, stabilityIndex: 1, stabilityCeiling: 1, criticalSteps: 0,
      galaxyCount: 0, starCount: 0, blackHoleCount: 0,
      habitableSystemsCount: 0, lifeBearingPlanetsCount: 0,
      civilizationCount: 0, metallicity: 0, energyBudget: 1,
      cosmicPhase: "dark_ages", stellarGenerations: 0,
    },
    metrics: {}, anomalies: [], civilizations: [], significantEvents: [],
    activeWars: [], milestones: {}, legacies: [], discoveries: [],
    research: { points: 0, totalEarned: 0 },
    simStep: 0,
    markModified() {},
  };
}

// Model a player tending their universe: whenever anomalies pile up, contain
// the oldest one. Pacing is measured for an ATTENTIVE warden, because that's
// who reaches Type III - a universe left entirely alone is supposed to
// collapse (asserted separately below).
function tendAnomalies(uni, keepBelow = 2) {
  const active = uni.anomalies.filter((a) => !a.resolved);
  if (active.length < keepBelow) return;
  const gen = new AnomalyGenerator(uni, { seed: uni.seed });
  for (const anomaly of active.slice(0, active.length - keepBelow + 1)) {
    gen.resolveAnomaly(anomaly.id, 85, 1); // a solid B-grade containment
  }
}

// Run N steps one at a time (forceSteps: 1) so wall-clock never gates us, and
// capture the step at which each milestone first occurs.
function runUniverse(steps, difficulty = "Intermediate", { tend = true } = {}) {
  const uni = makeUniverse(difficulty);
  const firstAt = {};
  const mark = (key, i) => { if (firstAt[key] === undefined) firstAt[key] = i; };
  let anomaliesSpawned = 0;
  let peakCivs = 0;
  let maxCivSpawnInOneStep = 0;

  for (let i = 1; i <= steps; i++) {
    const before = uni.civilizations.filter((c) => !c.extinct).length;
    const res = advanceUniverse(uni, new Date(), { forceSteps: 1 });
    anomaliesSpawned += res.createdAnomalies.length;
    if (tend) tendAnomalies(uni);

    const cs = uni.currentState;
    const active = uni.civilizations.filter((c) => !c.extinct);
    peakCivs = Math.max(peakCivs, active.length);
    maxCivSpawnInOneStep = Math.max(maxCivSpawnInOneStep, active.length - before);

    if (cs.galaxyCount > 0) mark("galaxies", i);
    if (cs.starCount > 0) mark("stars", i);
    if (cs.lifeBearingPlanetsCount >= 1) mark("life", i);
    if (active.length > 0) mark("civs", i);
    if (anomaliesSpawned > 0) mark("anomaly", i);
    if (res.createdAnomalies.some((a) => a.severity >= 4)) mark("siege", i);
    if (active.some((c) => c.type === "Type1")) mark("type1", i);
    if (active.some((c) => c.type === "Type2")) mark("type2", i);
    if (active.some((c) => c.type === "Type3" || c.ascended)) mark("type3", i);
    if (uni.status === "ended") break;
  }

  return { uni, firstAt, anomaliesSpawned, peakCivs, maxCivSpawnInOneStep };
}

test("a universe reaches Type III inside the ~400-step budget", () => {
  const { firstAt } = runUniverse(600);

  assert.ok(firstAt.type3 !== undefined, "a civilization must reach Type III");
  assert.ok(
    firstAt.type3 <= 520,
    `Type III at step ${firstAt.type3} - target is ~${COSMO.STEPS_TO_ASCENSION}, allow some RNG slack`
  );
  // And the ladder must be climbed in order, not skipped
  assert.ok(firstAt.type1 < firstAt.type2, "Type I precedes Type II");
  assert.ok(firstAt.type2 < firstAt.type3, "Type II precedes Type III");
});

test("the era milestones arrive in a sane order and early enough to matter", () => {
  const { firstAt } = runUniverse(450);

  assert.ok(firstAt.galaxies <= 40, `galaxies by step ${firstAt.galaxies}`);
  assert.ok(firstAt.stars <= 60, `stars by step ${firstAt.stars}`);
  assert.ok(firstAt.life !== undefined && firstAt.life <= 200, `life by step ${firstAt.life}`);
  assert.ok(firstAt.civs !== undefined && firstAt.civs <= 250, `civs by step ${firstAt.civs}`);
  assert.ok(firstAt.galaxies <= firstAt.stars, "galaxies before stars");
  assert.ok(firstAt.stars <= firstAt.life, "stars before life");
  assert.ok(firstAt.life <= firstAt.civs, "life before civilizations");
});

test("anomalies spawn naturally, and some are severe enough to be besieged", () => {
  const { anomaliesSpawned, firstAt } = runUniverse(400);

  // Regression: the old activity term made this exactly 0 over any run.
  assert.ok(anomaliesSpawned >= 10, `only ${anomaliesSpawned} anomalies in 400 steps`);
  assert.ok(anomaliesSpawned <= 150, `${anomaliesSpawned} anomalies is a spam feed`);
  assert.ok(firstAt.anomaly <= 150, `first anomaly at step ${firstAt.anomaly}`);
  assert.ok(
    firstAt.siege !== undefined,
    "at least one severity-4+ anomaly must appear (rift sieges need one)"
  );
});

test("civilizations ramp gradually instead of exploding to the cap", () => {
  const { peakCivs, maxCivSpawnInOneStep } = runUniverse(400);

  assert.ok(peakCivs > 0, "some civilizations must exist");
  assert.ok(
    peakCivs <= COSMO.MAX_CIVILIZATIONS,
    `peaked at ${peakCivs}, cap is ${COSMO.MAX_CIVILIZATIONS}`
  );
  // Regression: the old code spawned 10 per step straight into a 500 cap.
  assert.ok(
    maxCivSpawnInOneStep <= COSMO.MAX_CIV_SPAWNS_PER_STEP,
    `spawned ${maxCivSpawnInOneStep} civilizations in a single step`
  );
});

test("state variables stay physical instead of pinning at their clamps", () => {
  const { uni } = runUniverse(400);
  const cs = uni.currentState;

  // Metallicity is a fraction of SOLAR metallicity and saturates logistically;
  // it used to hit 1.0 (displayed "100%") within a few Gyr and freeze there.
  assert.ok(cs.metallicity > 0.02, `metallicity ${cs.metallicity} never got going`);
  assert.ok(cs.metallicity < 0.95, `metallicity ${cs.metallicity} pinned at its clamp`);

  // Free energy must visibly decline (it used to sit at ~1.0 forever, which
  // also made heat-death and stellar-death end conditions unreachable).
  assert.ok(cs.energyBudget < 0.9, `energyBudget ${cs.energyBudget} barely moved`);
  assert.ok(cs.energyBudget > 0.2, `energyBudget ${cs.energyBudget} collapsed too fast`);

  // Entropy must be LIVE against its own reference: neither negligible (the
  // term contributes nothing) nor saturated (the term is pinned at zero and
  // stops responding). Both failure modes have shipped before.
  const entropyRatio = cs.entropy / COSMO.ENTROPY_REFERENCE;
  assert.ok(entropyRatio > 0.05, `entropy ${cs.entropy} is negligible vs its reference`);
  assert.ok(entropyRatio < 1, `entropy ${cs.entropy} saturated its reference - term is dead`);

  // Structure must actually build toward the observable count.
  assert.ok(cs.galaxyCount > 1e9, `galaxyCount ${cs.galaxyCount} never matured`);
  assert.ok(cs.starCount > cs.galaxyCount, "stars outnumber galaxies");
});

test("every difficulty reaches the life era within its own budget", () => {
  for (const difficulty of ["Beginner", "Intermediate", "Advanced"]) {
    const { firstAt } = runUniverse(400, difficulty);
    assert.ok(
      firstAt.civs !== undefined,
      `${difficulty}: no civilizations within 400 steps`
    );
  }
});

test("a universe left entirely untended collapses (jeopardy still bites)", () => {
  const { uni } = runUniverse(400, "Intermediate", { tend: false });
  assert.equal(uni.status, "ended", "total neglect must have consequences");
  assert.equal(uni.endCondition, "instability-collapse");
});
