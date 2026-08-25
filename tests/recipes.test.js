// tests/recipes.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RECIPES, requirementFor, canAfford, spend } = require("../utils/recipes");
const { validatePurchase, UPGRADE_TRACKS } = require("../utils/upgradeCatalog");

const uni = (over = {}) => ({
  research: { points: 10000 },
  upgrades: { thrusters: 0, boostReactor: 0, scanner: 0, containment: 0 },
  materials: {},
  ...over,
});

test("Mk 1 needs no matter - early game is exactly as it was", () => {
  // The whole point of gating only the upper tiers: existing balance untouched.
  for (const track of Object.keys(UPGRADE_TRACKS)) {
    assert.equal(requirementFor(track, 0), null, track);
    const check = validatePurchase(uni(), track);
    assert.equal(check.ok, true, `${track} Mk 1 should need only RP`);
  }
});

test("every track's top tier is gated on matter", () => {
  for (const track of Object.keys(UPGRADE_TRACKS)) {
    const top = requirementFor(track, 2);
    assert.ok(top && Object.keys(top).length > 0, `${track} Mk 3 is not gated`);
  }
});

test("you cannot max your ship until the universe has forged the atoms", () => {
  // The thesis, in the one system players care about most: a Mk 3 Scanner
  // needs gold, and a young cosmos has no gold in it.
  const u = uni({ upgrades: { scanner: 2 }, materials: { carbon: 99, iron: 99 } });
  const check = validatePurchase(u, "scanner");
  assert.equal(check.ok, false);
  assert.match(check.reason, /gold/i);
  assert.ok(check.missing.gold > 0);
});

test("with the matter in hand the purchase goes through", () => {
  const u = uni({ upgrades: { scanner: 2 }, materials: { gold: 2, platinum: 1 } });
  const check = validatePurchase(u, "scanner");
  assert.equal(check.ok, true);
  assert.deepEqual(check.requirement, { gold: 2, platinum: 1 });
});

test("RP is still required - matter does not replace it", () => {
  // Upgrades are RP's only sink. Removing that would leave research points
  // with nothing to buy and make the abundance problem worse.
  const broke = uni({ research: { points: 0 }, materials: { iron: 99 } });
  const check = validatePurchase(broke, "thrusters");
  assert.equal(check.ok, false);
  assert.match(check.reason, /research/i);
});

test("a shortfall names exactly what is missing and how much", () => {
  const u = uni({ upgrades: { containment: 1 }, materials: { iron: 2 } });
  const check = validatePurchase(u, "containment");
  assert.equal(check.ok, false);
  assert.deepEqual(check.missing, { iron: 3, oxygen: 3 });
  assert.match(check.reason, /3 iron/);
  assert.match(check.reason, /3 oxygen/);
});

test("canAfford is exact at the boundary", () => {
  const req = { iron: 5, oxygen: 3 };
  assert.equal(canAfford({ iron: 5, oxygen: 3 }, req).ok, true);
  assert.equal(canAfford({ iron: 5, oxygen: 2 }, req).ok, false);
  assert.equal(canAfford({}, null).ok, true, "no requirement is always affordable");
});

test("spending deducts only what the recipe asked for", () => {
  const after = spend({ iron: 10, oxygen: 5, gold: 3 }, { iron: 4, oxygen: 2 });
  assert.equal(after.iron, 6);
  assert.equal(after.oxygen, 3);
  assert.equal(after.gold, 3, "untouched materials stay untouched");
});

test("spending can never drive a stock negative", () => {
  const after = spend({ iron: 1 }, { iron: 4 });
  assert.equal(after.iron, 0);
});

test("spending nothing is a no-op", () => {
  const before = { iron: 7 };
  assert.deepEqual(spend(before, null), before);
  assert.deepEqual(spend(undefined, null), {});
});

test("every recipe asks only for materials that exist", () => {
  const { MATERIAL_IDS } = require("../utils/materials");
  for (const [track, levels] of Object.entries(RECIPES)) {
    for (const req of levels) {
      if (!req) continue;
      for (const id of Object.keys(req)) {
        assert.ok(MATERIAL_IDS.includes(id), `${track} asks for unknown material ${id}`);
      }
    }
  }
});

test("recipes cover every upgrade track, at every level", () => {
  for (const [track, info] of Object.entries(UPGRADE_TRACKS)) {
    assert.ok(RECIPES[track], `${track} has no recipe`);
    assert.equal(RECIPES[track].length, info.costs.length,
      `${track} recipe levels must match its cost levels`);
  }
});
