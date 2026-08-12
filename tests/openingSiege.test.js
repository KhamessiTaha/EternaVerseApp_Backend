// tests/openingSiege.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  shouldStageOpeningSiege, stageOpeningSiege, ATTACKER_TIER, DEFENDER_TIER,
} = require("../utils/openingSiege");

const makeUniverse = (civs, over = {}) => ({
  status: "running",
  scriptedSiegeAt: null,
  civilizations: civs,
  activeWars: [],
  ...over,
});

const met = { id: "civ_known", type: "Type0", observed: true, extinct: false };

test("nothing is staged until the player has met a civilization", () => {
  const unmet = makeUniverse([{ id: "civ_a", type: "Type0", observed: false, extinct: false }]);
  assert.equal(shouldStageOpeningSiege(unmet), false);
  assert.equal(shouldStageOpeningSiege(makeUniverse([met])), true);
});

test("it happens exactly once per universe", () => {
  const uni = makeUniverse([met]);
  assert.equal(shouldStageOpeningSiege(uni), true);
  stageOpeningSiege(uni, [{ id: "d" }, { id: "a" }]);
  assert.ok(uni.scriptedSiegeAt instanceof Date);
  assert.equal(shouldStageOpeningSiege(uni), false);
});

test("a simulation that already grew a star-faring power is left alone", () => {
  for (const type of ["Type2", "Type3"]) {
    const uni = makeUniverse([met, { id: "civ_big", type, extinct: false }]);
    assert.equal(shouldStageOpeningSiege(uni), false, type);
  }
  // ...but a dead one doesn't count - it can't besiege anybody
  const uni = makeUniverse([met, { id: "civ_big", type: "Type3", extinct: true }]);
  assert.equal(shouldStageOpeningSiege(uni), true);
});

test("an ended universe stages nothing", () => {
  assert.equal(shouldStageOpeningSiege(makeUniverse([met], { status: "ended" })), false);
  assert.equal(shouldStageOpeningSiege(null), false);
});

test("staging promotes both sides and declares a scripted war", () => {
  const uni = makeUniverse([met]);
  const defender = { id: "civ_d", type: "Type0", technology: 3 };
  const attacker = { id: "civ_a", type: "Type0", technology: 3, warlikeness: 0.1 };

  const res = stageOpeningSiege(uni, [defender, attacker]);
  assert.ok(res);
  assert.equal(defender.type, DEFENDER_TIER);
  assert.equal(attacker.type, ATTACKER_TIER);
  assert.ok(attacker.technology >= 55, "a forced tier isn't a Type II that hasn't discovered fire");
  assert.ok(attacker.warlikeness >= 0.7);

  assert.equal(uni.activeWars.length, 1);
  assert.equal(uni.activeWars[0].scripted, true);
  assert.equal(uni.activeWars[0].a, "civ_d");
  assert.equal(uni.activeWars[0].b, "civ_a");
});

test("staging refuses a malformed pair rather than half-building a war", () => {
  const uni = makeUniverse([met]);
  assert.equal(stageOpeningSiege(uni, []), null);
  assert.equal(stageOpeningSiege(uni, [{ id: "x" }]), null);
  assert.equal(stageOpeningSiege(uni, [{ id: "x" }, { id: "x" }]), null, "a civ cannot besiege itself");
  assert.equal(uni.activeWars.length, 0);
  assert.equal(uni.scriptedSiegeAt, null);
});

// The whole point of the asymmetric shape: only a Type II can raise a raid
// wave, so the client's civUnderSiege never flags the aggressor back and the
// player gets ONE legible distress call instead of two worlds pointing at each
// other. The client half of this contract is asserted in the frontend's
// fleetModel.test.js ("the scripted opening siege has exactly one victim").
test("the staged tiers are what make the distress call legible", () => {
  const uni = makeUniverse([met]);
  const defender = { id: "civ_d", type: "Type0" };
  const attacker = { id: "civ_a", type: "Type0" };
  stageOpeningSiege(uni, [defender, attacker]);

  assert.equal(attacker.type, "Type2", "only a Type II can project force");
  assert.equal(defender.type, "Type1", "a Type I cannot raid back");
});
