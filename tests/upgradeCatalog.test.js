// tests/upgradeCatalog.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validatePurchase, UPGRADE_TRACKS } = require("../utils/upgradeCatalog");

// Stocked with matter by default so these tests stay about RP and levels.
// Mk 2+ now also costs materials (utils/recipes.js) - that gating has its own
// tests in recipes.test.js.
const STOCKED = {
  carbon: 99, oxygen: 99, iron: 99,
  gold: 99, platinum: 99, uranium: 99, degenerate: 99, hawking: 99,
};
const uni = (points, upgrades = {}, materials = STOCKED) =>
  ({ research: { points }, upgrades, materials });

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
