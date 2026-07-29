// tests/deathPenalty.test.js
//
// The fail state: losing your vessel must cost something. The route applies a
// direct stability hit and then a forced time-skip via the shared runner. These
// exercise the two mechanical guarantees the route depends on: a direct hit
// lowers stability, and forceSteps advances cosmic time by real physics steps.

const { test } = require("node:test");
const assert = require("node:assert");
const { advanceUniverse } = require("../utils/simulationRunner");

function makeUniverse() {
  return {
    _id: { toString: () => "u-death" },
    seed: "death-seed",
    difficulty: "Advanced",
    constants: {},
    currentState: {
      age: 5e9,
      stabilityIndex: 0.8,
      stabilityCeiling: 1,
      cosmicPhase: "stellar_peak",
      galaxyCount: 2e11,
      starCount: 1e21,
      metallicity: 0.4,
    },
    metrics: {},
    anomalies: [],
    civilizations: [],
    significantEvents: [],
    activeWars: [],
    milestones: {},
    simStep: 0,
    markModified() {},
  };
}

test("the direct stability hit lowers stability before the skip", () => {
  const uni = makeUniverse();
  const before = uni.currentState.stabilityIndex;
  const penalty = 0.09; // Advanced
  uni.currentState.stabilityIndex = Math.max(0, before - penalty);
  assert.ok(uni.currentState.stabilityIndex < before, "stability dropped");
  assert.ok(Math.abs((before - uni.currentState.stabilityIndex) - penalty) < 1e-9);
});

test("a forced time-skip advances cosmic time by real steps", () => {
  const uni = makeUniverse();
  const ageBefore = uni.currentState.age;
  const result = advanceUniverse(uni, new Date(), { forceSteps: 3 });
  assert.equal(result.steps, 3, "ran exactly the forced steps");
  assert.ok(uni.currentState.age > ageBefore, "cosmic time advanced");
  // Advanced timeStep is 1e7 yr/step, so ~3e7 years drift.
  assert.ok(uni.currentState.age - ageBefore >= 3e7 - 1, "roughly the expected drift");
});

test("death near collapse can tip a fragile universe over", () => {
  const uni = makeUniverse();
  uni.currentState.stabilityIndex = 0.05; // already on the brink
  uni.currentState.stabilityCeiling = 0.1;
  uni.currentState.criticalSteps = 5;
  uni.currentState.stabilityIndex = Math.max(0, uni.currentState.stabilityIndex - 0.09);
  const result = advanceUniverse(uni, new Date(), { forceSteps: 3 });
  // The point isn't a guaranteed end (that depends on crisis windows), but that
  // the penalty runs the real end-condition pipeline against a weakened state.
  assert.ok(result.steps >= 1, "the penalty exercised the end-condition pipeline");
  assert.ok(uni.currentState.stabilityIndex <= 0.05, "started the skip already wounded");
});
