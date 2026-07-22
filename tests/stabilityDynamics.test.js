// tests/stabilityDynamics.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const PhysicsEngine = require("../utils/physicsEngine");
const cfg = require("../utils/stabilityConfig");

// Minimal universe good enough for the stability methods.
function makeUniverse(over = {}) {
  return {
    seed: "t",
    constants: {},
    initialConditions: { initialTemperature: 2.725 },
    currentState: {
      age: 6e9, _scaleFactor: 1, expansionRate: 67.4, temperature: 2.725,
      entropy: 1e12, stabilityIndex: 0.9, galaxyCount: 1e9, starCount: 1e18,
      blackHoleCount: 1e5, habitableSystemsCount: 1e6, lifeBearingPlanetsCount: 1e4,
      civilizationCount: 0, metallicity: 0.2, energyBudget: 0.9,
      cosmicPhase: "stellar_peak", stellarGenerations: 3,
      criticalSteps: 0, stabilityCeiling: 1,
      ...(over.currentState || {}),
    },
    anomalies: over.anomalies || [],
    significantEvents: [], civilizations: [], milestones: {}, metrics: {},
  };
}
const anomaly = (severity, resolved = false) => ({ id: `a${Math.random()}`, severity, resolved, location: { x: 0, y: 0 } });

test("ceiling comes from cosmology health, excludes anomalies, in [0.5,1]", () => {
  const uni = makeUniverse({ anomalies: [anomaly(5), anomaly(5), anomaly(5)] });
  const eng = new PhysicsEngine(uni, {});
  eng._updateCeilingAndMetrics();
  const withAnomalies = uni.currentState.stabilityCeiling;
  const uni2 = makeUniverse({ anomalies: [] });
  const eng2 = new PhysicsEngine(uni2, {});
  eng2._updateCeilingAndMetrics();
  assert.equal(withAnomalies, uni2.currentState.stabilityCeiling, "anomalies must not affect the ceiling");
  assert.ok(withAnomalies >= 0.5 && withAnomalies <= 1);
});

test("active anomalies drain the reservoir", () => {
  // Start below the cosmology ceiling so the ceiling clamp doesn't mask the
  // exact drain we're measuring.
  const uni = makeUniverse({ currentState: { stabilityIndex: 0.7 }, anomalies: [anomaly(3), anomaly(3)] });
  const eng = new PhysicsEngine(uni, {});
  eng._updateCeilingAndMetrics();
  const before = uni.currentState.stabilityIndex;
  eng.applyStabilityDynamics({});
  const expectedDrain = 2 * 3 * cfg.STABILITY_DRAIN_PER_SEVERITY;
  assert.ok(uni.currentState.stabilityIndex < before);
  assert.ok(Math.abs((before - uni.currentState.stabilityIndex) - expectedDrain) < 1e-9);
});

test("regen climbs toward but not past the ceiling when calm", () => {
  const uni = makeUniverse({ currentState: { stabilityIndex: 0.4 }, anomalies: [] });
  const eng = new PhysicsEngine(uni, {});
  eng._updateCeilingAndMetrics();
  const ceiling = uni.currentState.stabilityCeiling;
  for (let i = 0; i < 500; i++) { eng._updateCeilingAndMetrics(); eng.applyStabilityDynamics({}); }
  assert.ok(uni.currentState.stabilityIndex <= ceiling + 1e-9);
  assert.ok(uni.currentState.stabilityIndex > 0.4);
});

test("offline drain is reduced and never breaches the floor", () => {
  const uni = makeUniverse({ currentState: { stabilityIndex: 0.22 }, anomalies: [anomaly(5), anomaly(5), anomaly(5), anomaly(5)] });
  const eng = new PhysicsEngine(uni, {});
  eng._updateCeilingAndMetrics();
  for (let i = 0; i < 50; i++) { eng._updateCeilingAndMetrics(); eng.applyStabilityDynamics({ offline: true }); }
  assert.ok(uni.currentState.stabilityIndex >= cfg.OFFLINE_FLOOR - 1e-9);
  assert.equal(uni.currentState.criticalSteps, 0, "offline never arms the crisis counter");
});

test("crisis counter arms online and clears on recovery", () => {
  const uni = makeUniverse({ currentState: { stabilityIndex: 0.10 }, anomalies: [anomaly(5), anomaly(5)] });
  const eng = new PhysicsEngine(uni, {});
  eng._updateCeilingAndMetrics();
  eng.applyStabilityDynamics({});
  assert.ok(uni.currentState.criticalSteps >= 1);
  uni.currentState.stabilityIndex = 0.4; // simulate a recovery
  eng.applyStabilityDynamics({});
  assert.equal(uni.currentState.criticalSteps, 0);
});

const AnomalyGenerator = require("../utils/anomalyGenerator");

test("escalateAndSpread ages, escalates, and can spawn a neighbor", () => {
  const uni = makeUniverse({ anomalies: [{ id: "x", type: "quantumFluctuation", category: "quantum", severity: 4, resolved: false, location: { x: 100, y: 100 }, stepsUnresolved: cfg.ESCALATION_STEP_THRESHOLD - 1 }] });
  const gen = new AnomalyGenerator(uni, { seed: "s", anomalyIdFactory: () => `n${Math.random()}` });
  gen.escalateAndSpread();
  assert.equal(uni.anomalies[0].stepsUnresolved, cfg.ESCALATION_STEP_THRESHOLD);
  assert.equal(uni.anomalies[0].severity, 5, "crossing the threshold bumps severity");
});

test("resolve refill persists and clamps to the ceiling", () => {
  const uni = makeUniverse({ currentState: { stabilityIndex: 0.5, stabilityCeiling: 0.8 }, anomalies: [{ id: "r", type: "quantumFluctuation", category: "quantum", severity: 3, resolved: false, location: { x: 0, y: 0 } }] });
  const gen = new AnomalyGenerator(uni, { seed: "s" });
  const res = gen.resolveAnomaly("r", 100, 1);
  assert.ok(res.success);
  const expected = Math.min(0.8, 0.5 + cfg.RESOLVE_REFILL_PER_SEVERITY * 3 * res.performanceMultiplier);
  assert.ok(Math.abs(uni.currentState.stabilityIndex - expected) < 1e-9);
  // A physics step must NOT wipe the refill:
  const eng = new PhysicsEngine(uni, {});
  eng._updateCeilingAndMetrics();
  eng.applyStabilityDynamics({});
  assert.ok(uni.currentState.stabilityIndex >= expected - 0.05, "refill survives a step");
});

const EndConditions = require("../utils/endConditions");

test("instability-collapse fires at the difficulty crisis window", () => {
  const uni = makeUniverse({ currentState: { criticalSteps: 6, stabilityIndex: 0.05 } });
  const beginner = new EndConditions(uni, { crisisWindow: 20 });
  assert.equal(beginner.checkEndConditions(), false, "6 < 20, Beginner survives");
  const advanced = new EndConditions(uni, { crisisWindow: 6 });
  assert.equal(advanced.checkEndConditions(), true, "6 >= 6, Advanced collapses");
  assert.equal(uni.status, "ended");
  assert.equal(uni.endCondition, "instability-collapse");
});
