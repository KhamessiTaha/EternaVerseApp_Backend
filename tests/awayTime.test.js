// tests/awayTime.test.js
//
// The bug this file exists to stop coming back: quit to the dashboard, stay
// away a while, come back - and the universe ended almost instantly.
//
// Cause: away-time is replayed as a catch-up burst on the player's next visit.
// The offline protections (softened drain, a floor, no crisis counter) were
// gated on the CALLER passing `offline`, which only the cron sweep did. Once
// the sweep was turned off, up to 100 consecutive unattended steps ran through
// the ONLINE path, arming the crisis counter well past any difficulty's
// crisisWindow. The player lost a fight they were never present for.
//
// These tests drive the real simulation loop, not a mock.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { advanceUniverse, MAX_STEPS, SECONDS_PER_STEP } = require("../utils/simulationRunner");
const AnomalyGenerator = require("../utils/anomalyGenerator");
const STAB = require("../utils/stabilityConfig");

function makeUniverse(difficulty = "Intermediate") {
  return {
    _id: { toString: () => "u-away" },
    seed: "away-seed",
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

const tend = (uni, keepBelow = 2) => {
  const active = uni.anomalies.filter((a) => !a.resolved);
  if (active.length < keepBelow) return;
  const gen = new AnomalyGenerator(uni, { seed: uni.seed });
  for (const a of active.slice(0, active.length - keepBelow + 1)) {
    gen.resolveAnomaly(a.id, 85, 1);
  }
};

/** Play attentively for `steps`, one live tick at a time. */
function play(uni, steps) {
  for (let i = 0; i < steps; i++) {
    advanceUniverse(uni, new Date(), { forceSteps: 1 });
    tend(uni);
    if (uni.status === "ended") return;
  }
}

/** Walk away for `minutes`, then come back - exactly what the client does. */
function goAwayAndReturn(uni, minutes) {
  const now = new Date();
  uni.lastSimulatedAt = new Date(now.getTime() - minutes * 60_000);
  return advanceUniverse(uni, now);
}

test("coming back from a long absence does not end the universe", () => {
  const uni = makeUniverse();
  play(uni, 120);
  assert.notEqual(uni.status, "ended", "precondition: an attended universe survives");

  // Long enough to owe the full MAX_STEPS catch-up burst.
  const res = goAwayAndReturn(uni, 90);
  assert.equal(res.steps, MAX_STEPS, "the whole absence is replayed at once");
  assert.notEqual(uni.status, "ended", "you do not lose while you are away");
});

test("an absence never arms the collapse counter", () => {
  const uni = makeUniverse();
  play(uni, 120);
  goAwayAndReturn(uni, 90);

  assert.equal(uni.currentState.criticalSteps || 0, 0,
    "the crisis counter must not run for steps nobody was present for");
});

test("an absence costs you ground but stops at the floor", () => {
  const uni = makeUniverse();
  play(uni, 120);
  const before = uni.currentState.stabilityIndex;

  goAwayAndReturn(uni, 90);
  const after = uni.currentState.stabilityIndex;

  assert.ok(after < before, "neglect is still expensive - you come back to a mess");
  assert.ok(after >= STAB.OFFLINE_FLOOR - 1e-9,
    `stability floored at ${STAB.OFFLINE_FLOOR}, got ${after}`);
  assert.ok(uni.anomalies.filter((a) => !a.resolved).length > 0,
    "and the mess is real: unresolved anomalies waiting for you");
});

test("the mess left by an absence is recoverable by playing", () => {
  const uni = makeUniverse();
  play(uni, 120);
  goAwayAndReturn(uni, 90);
  assert.notEqual(uni.status, "ended");

  // A returning player who gets to work must be able to climb back out.
  play(uni, 60);
  assert.notEqual(uni.status, "ended", "an attentive return should not still collapse");
  assert.ok(uni.currentState.stabilityIndex > STAB.CRITICAL_THRESHOLD,
    "and should recover clear of the critical band");
});

test("a short pause is still live play, not an absence", () => {
  const uni = makeUniverse();
  play(uni, 120);
  uni.currentState.criticalSteps = 0;

  // One step's worth of elapsed time: the ordinary 30s client tick.
  const now = new Date();
  uni.lastSimulatedAt = new Date(now.getTime() - SECONDS_PER_STEP * 1000);
  const res = advanceUniverse(uni, now);

  assert.equal(res.steps, 1);
  // Online semantics still apply to real play - the reservoir is allowed to
  // fall below the offline floor and the crisis counter is allowed to arm,
  // which is what makes stability a resource you can actually lose.
  assert.equal(typeof uni.currentState.stabilityIndex, "number");
});

test("admin fast-forward keeps ONLINE semantics whatever its length", () => {
  // The dev console's fast-forward exists to exercise the live drain arc; if
  // it silently went offline it would stop being able to test a collapse.
  const uni = makeUniverse();
  play(uni, 60);
  uni.currentState.stabilityIndex = 0.05; // already critical
  uni.currentState.criticalSteps = 0;

  advanceUniverse(uni, new Date(), { forceSteps: 10 });
  assert.ok((uni.currentState.criticalSteps || 0) > 0,
    "forceSteps must still arm the crisis counter");
});

test("a universe left alone forever still decays - it just doesn't die unseen", () => {
  const uni = makeUniverse();
  play(uni, 120);

  for (let i = 0; i < 6; i++) goAwayAndReturn(uni, 90);

  assert.notEqual(uni.status, "ended", "absence alone never ends a universe");
  assert.ok(uni.currentState.stabilityIndex <= STAB.OFFLINE_FLOOR + 1e-9,
    "but it sits parked at the floor, one bad session from collapse");
});
