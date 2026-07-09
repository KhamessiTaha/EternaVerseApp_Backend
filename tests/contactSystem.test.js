// tests/contactSystem.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { applyContact, OBSERVE_REWARDS, UPLIFT_BASE_COST, MAX_USES } = require("../utils/contactSystem");

const makeUni = (civOver = {}, points = 1000) => ({
  research: { points, totalEarned: points },
  civilizations: [{
    id: "civ_1_abc",
    type: "Type1",
    technology: 30,
    stability: 0.5,
    developmentLevel: 0.4,
    warlikeness: 0.5,
    extinct: false,
    observed: false,
    uplifts: 0,
    pacifies: 0,
    ...civOver,
  }],
});

test("observe awards type-scaled RP exactly once", () => {
  const uni = makeUni({}, 0);
  const first = applyContact(uni, "civ_1_abc", "observe");
  assert.equal(first.ok, true);
  assert.equal(first.reward, OBSERVE_REWARDS.Type1);
  assert.equal(uni.research.points, OBSERVE_REWARDS.Type1);

  const second = applyContact(uni, "civ_1_abc", "observe");
  assert.equal(second.ok, false);
  assert.match(second.reason, /already/i);
});

test("uplift succeeds when rand beats the backfire chance, and charges escalating costs", () => {
  const uni = makeUni({ warlikeness: 0.5 });
  const noBackfire = () => 0.99; // above 0.5 * 0.35 = 0.175
  const r = applyContact(uni, "civ_1_abc", "uplift", noBackfire);
  assert.equal(r.ok, true);
  assert.equal(r.outcome, "uplifted");
  assert.equal(r.cost, UPLIFT_BASE_COST);
  assert.equal(uni.research.points, 1000 - UPLIFT_BASE_COST);

  const r2 = applyContact(uni, "civ_1_abc", "uplift", noBackfire);
  assert.equal(r2.cost, UPLIFT_BASE_COST * 2);
});

test("uplift backfires when rand falls under warlikeness * factor", () => {
  const uni = makeUni({ warlikeness: 1 });
  const before = uni.civilizations[0].warlikeness;
  const r = applyContact(uni, "civ_1_abc", "uplift", () => 0.1); // under 0.35
  assert.equal(r.ok, true);
  assert.equal(r.outcome, "backfire");
  assert.ok(uni.civilizations[0].warlikeness >= before || uni.civilizations[0].warlikeness === 1);
  assert.equal(uni.research.points, 1000 - UPLIFT_BASE_COST); // still paid
});

test("a fully pacifist civ can never trigger a backfire", () => {
  const uni = makeUni({ warlikeness: 0 });
  const r = applyContact(uni, "civ_1_abc", "uplift", () => 0); // worst possible roll
  assert.equal(r.outcome, "uplifted");
});

test("use caps and insufficient research are rejected without side effects", () => {
  const capped = makeUni({ uplifts: MAX_USES });
  assert.equal(applyContact(capped, "civ_1_abc", "uplift").ok, false);

  const broke = makeUni({}, 10);
  const r = applyContact(broke, "civ_1_abc", "uplift");
  assert.equal(r.ok, false);
  assert.equal(broke.research.points, 10); // not charged
  assert.equal(broke.civilizations[0].uplifts, 0);
});

test("pacify reduces warlikeness and clamps at zero", () => {
  const uni = makeUni({ warlikeness: 0.1 });
  const r = applyContact(uni, "civ_1_abc", "pacify");
  assert.equal(r.ok, true);
  assert.equal(uni.civilizations[0].warlikeness, 0);
});

test("extinct and unknown civs are rejected", () => {
  assert.equal(applyContact(makeUni({ extinct: true }), "civ_1_abc", "observe").ok, false);
  assert.equal(applyContact(makeUni(), "civ_nope", "observe").ok, false);
  assert.equal(applyContact(makeUni(), "civ_1_abc", "invade").ok, false);
});
