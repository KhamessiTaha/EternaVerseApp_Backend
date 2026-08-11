// tests/bombardment.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  applyBombardment, BOMBARD_POP_LOSS, WAR_SCORE_SWING, MAX_RUNS_PER_REPORT,
} = require("../utils/bombardment");

const makeUniverse = (over = {}) => ({
  civilizations: [
    { id: "civ_att", type: "Type2", extinct: false },
    {
      id: "civ_def", type: "Type2", extinct: false,
      population: 1e9, stability: 0.8, age: 4.2, ...over,
    },
    { id: "civ_neutral", type: "Type1", extinct: false, population: 1e8, stability: 0.9 },
  ],
  activeWars: [{ id: "w1", a: "civ_def", b: "civ_att", scoreA: 10, scoreB: 40 }],
  currentState: { civilizationCount: 3, civilizationsExtinct: 0 },
});

const target = (uni) => uni.civilizations.find((c) => c.id === "civ_def");

test("a bombardment run kills people and breaks the society", () => {
  const uni = makeUniverse();
  const res = applyBombardment(uni, "civ_def", 1, { attackerCivId: "civ_att" });

  assert.ok(res.ok);
  assert.equal(res.extinct, false);
  assert.equal(target(uni).population, Math.floor(1e9 * (1 - BOMBARD_POP_LOSS)));
  assert.ok(target(uni).stability < 0.8);
  assert.ok(res.effects.populationLost > 0);
});

test("runs compound - a longer siege costs far more than a short one", () => {
  const one = makeUniverse();
  applyBombardment(one, "civ_def", 1, { attackerCivId: "civ_att" });
  const four = makeUniverse();
  applyBombardment(four, "civ_def", 4, { attackerCivId: "civ_att" });

  assert.ok(target(four).population < target(one).population * 0.8);
});

test("the attacker gains ground in the war for every run that lands", () => {
  const uni = makeUniverse();
  applyBombardment(uni, "civ_def", 3, { attackerCivId: "civ_att" });
  // civ_att is side B of this war
  assert.equal(uni.activeWars[0].scoreB, 40 + WAR_SCORE_SWING * 3);
  assert.equal(uni.activeWars[0].scoreA, 10, "the defender gains nothing from being bombed");
});

test("an unopposed siege ends a civilization", () => {
  const uni = makeUniverse({ stability: 0.12 });
  const res = applyBombardment(uni, "civ_def", 2, { attackerCivId: "civ_att" });

  assert.ok(res.ok);
  assert.equal(res.extinct, true);
  const dead = target(uni);
  assert.equal(dead.extinct, true);
  assert.equal(dead.population, 0);
  assert.ok(dead.extinctionDate instanceof Date);
  assert.equal(dead.extinctionAge, 4.2);
  assert.match(res.message, /extinction/i);
});

test("extinction also ends the war and updates the census", () => {
  const uni = makeUniverse({ stability: 0.05 });
  applyBombardment(uni, "civ_def", 1, { attackerCivId: "civ_att" });

  assert.deepEqual(uni.activeWars, [], "there is nothing left to fight over");
  assert.equal(uni.currentState.civilizationsExtinct, 1);
  assert.equal(uni.currentState.civilizationCount, 2);
});

test("a world empties out even if its institutions hold", () => {
  // Plenty of stability left, but almost nobody alive
  const uni = makeUniverse({ population: 1.5e5, stability: 1 });
  const res = applyBombardment(uni, "civ_def", 3, { attackerCivId: "civ_att" });
  assert.equal(res.extinct, true);
  assert.ok(target(uni).stability > 0.5, "it was the dying, not the despair");
});

test("bombardment requires a real war - a client cannot invent one", () => {
  const uni = makeUniverse();
  const res = applyBombardment(uni, "civ_neutral", 5, { attackerCivId: "civ_att" });
  assert.equal(res.ok, false);
  assert.match(res.reason, /no war/i);
  assert.equal(uni.civilizations[2].population, 1e8, "untouched");
});

test("unknown and already-dead targets are refused", () => {
  const uni = makeUniverse();
  assert.equal(applyBombardment(uni, "nope", 1, { attackerCivId: "civ_att" }).ok, false);

  target(uni).extinct = true;
  assert.equal(applyBombardment(uni, "civ_def", 1, { attackerCivId: "civ_att" }).ok, false);
});

test("a reconnecting client cannot bank an hour of runs into one report", () => {
  const uni = makeUniverse({ population: 1e12, stability: 1 });
  const res = applyBombardment(uni, "civ_def", 9999, { attackerCivId: "civ_att" });
  assert.ok(res.ok);
  assert.equal(res.effects.runs, MAX_RUNS_PER_REPORT);
  assert.equal(res.extinct, false, "the clamp keeps one request from erasing a healthy world");
});
