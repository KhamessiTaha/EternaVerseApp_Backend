// tests/materials.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  MATERIALS, MATERIAL_IDS, MAX_GRADE, isAvailable, harvestableFrom, grantHarvest,
} = require("../utils/materials");

const uni = (cs = {}, materials = {}) => ({
  currentState: {
    age: 0, metallicity: 0, stellarGenerations: 0, blackHoleCount: 0, ...cs,
  },
  materials,
});

const YOUNG = () => uni();
// A real run reaches ~1e17 black holes; the tier-5 gates sit at 3e16 and 5e16,
// so a "mature" fixture needs a mature black-hole population, not a round number.
const MATURE = () => uni({ metallicity: 0.7, stellarGenerations: 6, blackHoleCount: 1e17 });

test("the era gate is enforced HERE, not trusted from the client", () => {
  // A client claiming gold from a universe that never merged a neutron star
  // gets nothing - and doesn't have to be trusted not to try.
  const young = YOUNG();
  const res = grantHarvest(young, "merger", 2.6);
  assert.equal(res.ok, false);
  assert.equal(res.empty, true);
  assert.deepEqual(young.materials, {}, "nothing was granted");
});

test("a young universe still yields what the Big Bang made", () => {
  const young = YOUNG();
  const res = grantHarvest(young, "nebula", 1, () => 0);
  assert.equal(res.ok, true);
  assert.ok(["hydrogen", "helium"].includes(res.id));
  assert.ok(res.amount >= 1);
  assert.equal(young.materials[res.id], res.amount);
});

test("harvests accumulate on the universe", () => {
  const u = YOUNG();
  grantHarvest(u, "nebula", 1, () => 0);
  const first = u.materials.hydrogen;
  grantHarvest(u, "nebula", 1, () => 0);
  assert.equal(u.materials.hydrogen, first * 2);
});

test("a supernova never yields gold, however rich the universe", () => {
  const u = MATURE();
  for (let i = 0; i < 50; i++) {
    const res = grantHarvest(u, "supernova", 1, () => i / 50);
    assert.equal(res.id, "iron", "iron is the only thing a supernova gives");
  }
});

test("the heavy elements come only from a merger", () => {
  const u = MATURE();
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    seen.add(grantHarvest(u, "merger", 1, () => i / 200).id);
  }
  for (const id of seen) {
    assert.ok(MATERIALS[id].sources.includes("merger"), `${id} is not a merger product`);
  }
  assert.ok(seen.has("gold"), "a mature merger must be able to give gold");
});

test("a tampered grade buys no more than a flawless one", () => {
  const u = YOUNG();
  const honest = grantHarvest(u, "nebula", MAX_GRADE, () => 0).amount;
  const cheat = grantHarvest(u, "nebula", 9999, () => 0).amount;
  assert.equal(cheat, honest);
});

test("a negative or junk grade still yields something, never nothing", () => {
  const u = YOUNG();
  for (const g of [-5, 0, NaN, "nonsense", undefined]) {
    const res = grantHarvest(u, "nebula", g, () => 0);
    assert.equal(res.ok, true);
    assert.ok(res.amount >= 1, `grade ${String(g)} produced ${res.amount}`);
  }
});

test("an unknown source is refused", () => {
  const res = grantHarvest(MATURE(), "wishful-thinking", 1);
  assert.equal(res.ok, false);
  assert.match(res.reason, /unknown/i);
});

test("gates mirror the client's thresholds exactly", () => {
  // If these drift, the client promises harvests the server won't grant.
  assert.equal(isAvailable("carbon", { stellarGenerations: 1 }), true);
  assert.equal(isAvailable("carbon", { stellarGenerations: 0.9 }), false);
  assert.equal(isAvailable("iron", { stellarGenerations: 2 }), true);
  assert.equal(isAvailable("gold", { metallicity: 0.3 }), true);
  assert.equal(isAvailable("gold", { metallicity: 0.29 }), false);
  assert.equal(isAvailable("platinum", { metallicity: 0.4 }), true);
  assert.equal(isAvailable("uranium", { metallicity: 0.45 }), true);
  assert.equal(isAvailable("uranium", { metallicity: 0.44 }), false);
  // Both tier-5s moved onto blackHoleCount: stellarGenerations saturates at
  // its clamp of 10 by step 25, and every universe is seeded with black holes,
  // so the old gates opened on steps 3 and 1 respectively.
  assert.equal(isAvailable("degenerate", { stellarGenerations: 10 }), false);
  assert.equal(isAvailable("degenerate", { blackHoleCount: 3e16 }), true);
  assert.equal(isAvailable("hawking", { blackHoleCount: 5e3 }), false);
  assert.equal(isAvailable("hawking", { blackHoleCount: 5e16 }), true);
});

test("every material is obtainable inside a run, on the hardest difficulty", () => {
  // The state a real universe is actually in after a 400-step run on Advanced,
  // measured by stepping the live PhysicsEngine. Advanced ages slowest per
  // step, so it is the worst case for every gate.
  //
  // This is the guard for a whole class of bug: a gate written against the
  // 0-1 range a quantity appears to have, rather than the range a universe
  // reaches. Enrichment saturates near 60% of solar and stops, so uranium's
  // old 0.6 gate opened on step 748, 1110, or never.
  const endOfHardestRun = { metallicity: 0.483, stellarGenerations: 10, blackHoleCount: 8.3e16 };
  const missing = MATERIAL_IDS.filter((id) => !isAvailable(id, endOfHardestRun));
  assert.deepEqual(missing, [], `unreachable in a real run: ${missing.join(", ")}`);
});

test("a malformed universe never throws", () => {
  for (const junk of [{}, { currentState: null }, { currentState: { metallicity: "x" } }]) {
    assert.doesNotThrow(() => grantHarvest(junk, "nebula", 1, () => 0));
  }
});

test("every material is reachable from at least one source", () => {
  const mature = MATURE().currentState;
  for (const id of MATERIAL_IDS) {
    const reachable = MATERIALS[id].sources.some((s) => harvestableFrom(s, mature).includes(id));
    assert.ok(reachable, `${id} can never be obtained`);
  }
});
