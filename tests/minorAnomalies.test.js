// tests/minorAnomalies.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyMinorResolution } = require("../utils/minorAnomalies");

const uni = (over = {}) => ({
  currentState: { stabilityIndex: 0.5 },
  research: { points: 0, totalEarned: 0 },
  metrics: { anomaliesResolved: 0 },
  upgrades: {},
  resolvedMinorAnomalies: [],
  ...over,
});

test("valid resolution grants RP, stability, and mission credit", () => {
  const u = uni();
  const r = applyMinorResolution(u, { anomalyId: "3:-2:1", severity: 2, accuracy: 92 });
  assert.equal(r.ok, true);
  assert.ok(r.reward > 0);
  assert.equal(u.research.points, r.reward);
  assert.ok(u.currentState.stabilityIndex > 0.5);
  assert.equal(u.metrics.anomaliesResolved, 1);
});

test("duplicates are rejected without side effects", () => {
  const u = uni();
  applyMinorResolution(u, { anomalyId: "0:0:0", severity: 1, accuracy: 70 });
  const before = u.research.points;
  const r = applyMinorResolution(u, { anomalyId: "0:0:0", severity: 1, accuracy: 70 });
  assert.equal(r.ok, false);
  assert.equal(r.duplicate, true);
  assert.equal(u.research.points, before);
  assert.equal(u.metrics.anomaliesResolved, 1);
});

test("malformed ids are rejected (no backend-id or garbage passthrough)", () => {
  const u = uni();
  for (const bad of ["abc", "1:2", "673ab_123_456", "1:2:3:4", "", null]) {
    assert.equal(applyMinorResolution(u, { anomalyId: bad, severity: 1, accuracy: 70 }).ok, false);
  }
});

test("severity and accuracy are clamped server-side", () => {
  const u = uni();
  const r = applyMinorResolution(u, { anomalyId: "0:0:1", severity: 99, accuracy: 9000 });
  assert.equal(r.ok, true);
  assert.equal(r.severity, 3); // clamped
});

test("containment upgrade scales the stability boost", () => {
  const plain = uni();
  const rigged = uni({ upgrades: { containment: 3 } });
  const a = applyMinorResolution(plain, { anomalyId: "0:0:2", severity: 2, accuracy: 80 });
  const b = applyMinorResolution(rigged, { anomalyId: "0:0:2", severity: 2, accuracy: 80 });
  assert.ok(b.stabilityBoost > a.stabilityBoost);
});
