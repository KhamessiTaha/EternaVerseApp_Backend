// tests/upgradeCatalog.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validatePurchase, UPGRADE_TRACKS } = require("../utils/upgradeCatalog");

const uni = (points, upgrades = {}) => ({ research: { points }, upgrades });

test("rejects unknown tracks", () => {
  const r = validatePurchase(uni(1000), "warpDrive");
  assert.equal(r.ok, false);
  assert.match(r.reason, /Unknown/);
});

test("charges the cost for the CURRENT level, not the next", () => {
  const r = validatePurchase(uni(1000, { thrusters: 1 }), "thrusters");
  assert.equal(r.ok, true);
  assert.equal(r.cost, UPGRADE_TRACKS.thrusters.costs[1]);
  assert.equal(r.nextLevel, 2);
});

test("rejects when at max level", () => {
  const maxed = UPGRADE_TRACKS.scanner.costs.length;
  const r = validatePurchase(uni(99999, { scanner: maxed }), "scanner");
  assert.equal(r.ok, false);
  assert.match(r.reason, /maximum/);
});

test("rejects when research is insufficient (boundary exact-cost passes)", () => {
  const cost = UPGRADE_TRACKS.containment.costs[0];
  assert.equal(validatePurchase(uni(cost - 1), "containment").ok, false);
  assert.equal(validatePurchase(uni(cost), "containment").ok, true);
});

test("treats missing research/upgrades subdocs as zero, not a crash", () => {
  const r = validatePurchase({}, "thrusters");
  assert.equal(r.ok, false);
  assert.match(r.reason, /Insufficient/);
});

test("does not mutate the universe", () => {
  const u = uni(500, { thrusters: 1 });
  validatePurchase(u, "thrusters");
  assert.equal(u.research.points, 500);
  assert.equal(u.upgrades.thrusters, 1);
});
