// tests/warStrike.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyWarStrike, WAR_SCORE_SWING, INTERVENTION_RP } = require("../utils/warStrike");

const makeUniverse = () => ({
  civilizations: [
    { id: "civ_att", type: "Type2", relationship: 0.2, warlikeness: 0.4, extinct: false },
    { id: "civ_def", type: "Type2", relationship: 0, warlikeness: 0.3, extinct: false },
    { id: "civ_bystander", type: "Type1", relationship: 0.5, extinct: false },
  ],
  activeWars: [{ id: "w1", a: "civ_def", b: "civ_att", scoreA: 10, scoreB: 40 }],
  research: { points: 100, totalEarned: 100 },
});

test("striking a civilization costs you its regard and hardens it", () => {
  const uni = makeUniverse();
  const res = applyWarStrike(uni, "civ_att", 2);
  assert.ok(res.ok);
  const struck = uni.civilizations.find((c) => c.id === "civ_att");
  assert.ok(struck.relationship < 0.2, "they resent you");
  assert.ok(struck.warlikeness > 0.4, "and militarize");
  assert.equal(struck.observed, true);
});

test("breaking a siege tips the war toward the defender and earns gratitude", () => {
  const uni = makeUniverse();
  const war = uni.activeWars[0];
  const beforeA = war.scoreA;

  const res = applyWarStrike(uni, "civ_att", 3, { defendingCivId: "civ_def" });
  assert.ok(res.ok);
  assert.equal(res.brokeSiege, true);
  assert.equal(war.scoreA, beforeA + WAR_SCORE_SWING * 3, "the defender gains ground");

  const defended = uni.civilizations.find((c) => c.id === "civ_def");
  assert.ok(defended.relationship > 0, "the saved world is grateful");
  assert.match(res.message, /broke the siege/i);
});

test("kills unrelated to a real war do not tip anything", () => {
  const uni = makeUniverse();
  const war = uni.activeWars[0];
  const before = { a: war.scoreA, b: war.scoreB };

  // civ_bystander is not at war with anyone
  const res = applyWarStrike(uni, "civ_bystander", 1, { defendingCivId: "civ_def" });
  assert.ok(res.ok);
  assert.equal(res.brokeSiege, false);
  assert.equal(war.scoreA, before.a);
  assert.equal(war.scoreB, before.b);
});

test("intervention pays RP, scaled to what the attacker could field", () => {
  const uni = makeUniverse();
  applyWarStrike(uni, "civ_att", 2, { defendingCivId: "civ_def" });
  assert.equal(uni.research.points, 100 + INTERVENTION_RP.Type2 * 2);
  assert.equal(uni.research.totalEarned, 100 + INTERVENTION_RP.Type2 * 2);

  const bigger = makeUniverse();
  bigger.civilizations[0].type = "Type3";
  applyWarStrike(bigger, "civ_att", 2, { defendingCivId: "civ_def" });
  assert.ok(bigger.research.points > uni.research.points, "a dreadnought is worth more");
});

test("shooting a DEFENDER is piracy, not intervention - it pays nothing", () => {
  const uni = makeUniverse();
  const res = applyWarStrike(uni, "civ_def", 3, { defendingCivId: "civ_att" });
  assert.ok(res.ok);
  // The war exists in both directions, so the score still tips - but the
  // people you shot are the ones being invaded, and that earns you no reward
  // beyond their hatred.
  assert.equal(uni.research.points, 100 + INTERVENTION_RP.Type2 * 3,
    "civ_att is Type2, so defending IT from civ_def pays at the Type2 rate");
  const struck = uni.civilizations.find((c) => c.id === "civ_def");
  assert.ok(struck.relationship < 0, "they resent you either way");
});

test("a rescue is credited once per war, however long the siege runs", () => {
  const uni = makeUniverse();
  applyWarStrike(uni, "civ_att", 2, { defendingCivId: "civ_def" });
  applyWarStrike(uni, "civ_att", 2, { defendingCivId: "civ_def" });
  applyWarStrike(uni, "civ_att", 5, { defendingCivId: "civ_def" });

  const defended = uni.civilizations.find((c) => c.id === "civ_def");
  assert.equal(defended.rescues, 1, "one war, one rescue on the legacy record");
});

test("kills with no siege behind them pay nothing", () => {
  const uni = makeUniverse();
  applyWarStrike(uni, "civ_bystander", 4);
  assert.equal(uni.research.points, 100);
});

test("kill counts are clamped and unknown/dead civs are refused", () => {
  const uni = makeUniverse();
  assert.equal(applyWarStrike(uni, "nope", 1).ok, false);

  uni.civilizations[2].extinct = true;
  assert.equal(applyWarStrike(uni, "civ_bystander", 1).ok, false);

  const res = applyWarStrike(uni, "civ_att", 9999);
  assert.ok(res.ok);
  assert.ok(res.effects.kills <= 20, "an absurd client claim is clamped");
});
