// tests/petitionSystem.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  derivePersonality, generatePetitions, respondToPetition, expirePetitions,
  MAX_ACTIVE_PETITIONS, PETITION_DEADLINE_STEPS,
} = require("../utils/petitionSystem");

const makeUni = (civOver = {}, points = 1000, wars = []) => ({
  research: { points, totalEarned: points },
  activeWars: wars,
  civilizations: [{
    id: "civ_1_abc", type: "Type1", technology: 30, stability: 0.5, developmentLevel: 0.4,
    warlikeness: 0.5, population: 1e7, resourceDepletion: 0.1, extinct: false,
    observed: true, uplifts: 0, pacifies: 0, relationship: 0.3,
    location: { x: 100, y: 100 }, petition: null, personality: null,
    ...civOver,
  }],
});

test("derivePersonality is deterministic on stats", () => {
  assert.equal(derivePersonality({ warlikeness: 0.8 }), "militant");
  assert.equal(derivePersonality({ warlikeness: 0.1, technology: 70, type: "Type2" }), "scholarly");
  const tag = derivePersonality({ warlikeness: 0.1, type: "Type0" }, () => 0.1);
  assert.ok(["devout", "insular"].includes(tag));
});

test("a warlike civ at war raises an aid petition", () => {
  const uni = makeUni({ warlikeness: 0.6 }, 1000, [{ id: "w1", a: "civ_1_abc", b: "civ_2_xyz" }]);
  const created = generatePetitions(uni, 1, () => 0.0); // 0 < BASE_PETITION_CHANCE -> fires
  assert.equal(created.length, 1);
  assert.equal(uni.civilizations[0].petition.kind, "aid");
  assert.ok(uni.civilizations[0].personality); // assigned
});

test("a dying civ raises a crisis petition regardless of war", () => {
  const uni = makeUni({ resourceDepletion: 0.8 });
  generatePetitions(uni, 1, () => 0.0);
  assert.equal(uni.civilizations[0].petition.kind, "crisis");
});

test("generation respects the active-petition cap and eligibility", () => {
  const uni = makeUni();
  // add a second eligible civ
  uni.civilizations.push({ ...uni.civilizations[0], id: "civ_2", petition: null });
  uni.civilizations.push({ ...uni.civilizations[0], id: "civ_3_unknown", observed: false, relationship: 0, petition: null });
  generatePetitions(uni, 1, () => 0.0);
  const active = uni.civilizations.filter((c) => c.petition).length;
  assert.ok(active <= MAX_ACTIVE_PETITIONS);
  // the unknown civ (never observed, neutral) must not petition
  assert.equal(uni.civilizations.find((c) => c.id === "civ_3_unknown").petition, null);
});

test("crisis intervene costs RP, saves the civ, and clears the petition", () => {
  const uni = makeUni({ resourceDepletion: 0.85, stability: 0.2 }, 500);
  generatePetitions(uni, 1, () => 0.0);
  const pid = uni.civilizations[0].petition.id;
  const res = respondToPetition(uni, "civ_1_abc", pid, "intervene");
  assert.equal(res.ok, true);
  assert.equal(uni.research.points, 380); // 500 - 120
  assert.ok(uni.civilizations[0].resourceDepletion < 0.85);
  assert.ok(uni.civilizations[0].stability > 0.2);
  assert.equal(uni.civilizations[0].petition, null);
});

test("insufficient RP leaves the petition standing", () => {
  const uni = makeUni({ resourceDepletion: 0.85 }, 50);
  generatePetitions(uni, 1, () => 0.0);
  const pid = uni.civilizations[0].petition.id;
  const res = respondToPetition(uni, "civ_1_abc", pid, "intervene");
  assert.equal(res.ok, false);
  assert.ok(uni.civilizations[0].petition); // still there to answer later
});

test("a stale petitionId is rejected", () => {
  const uni = makeUni({ resourceDepletion: 0.85 });
  generatePetitions(uni, 1, () => 0.0);
  const res = respondToPetition(uni, "civ_1_abc", "wrong-id", "intervene");
  assert.equal(res.ok, false);
});

test("tribute accept grants RP and nudges relationship up", () => {
  const uni = makeUni({ relationship: 0.6, warlikeness: 0.1, resourceDepletion: 0.1 }, 0);
  generatePetitions(uni, 1, () => 0.0); // friendly -> tribute
  const p = uni.civilizations[0].petition;
  assert.equal(p.kind, "tribute");
  const before = uni.civilizations[0].relationship;
  respondToPetition(uni, "civ_1_abc", p.id, "accept");
  assert.ok(uni.research.points > 0);
  assert.ok(uni.civilizations[0].relationship > before);
});

test("unanswered petitions expire to their default branch", () => {
  const uni = makeUni({ resourceDepletion: 0.85, stability: 0.4 });
  generatePetitions(uni, 1, () => 0.0);
  assert.ok(uni.civilizations[0].petition);
  // not yet past deadline
  let ev = expirePetitions(uni, 1 + PETITION_DEADLINE_STEPS - 1, () => 0.5);
  assert.equal(ev.length, 0);
  assert.ok(uni.civilizations[0].petition);
  // past deadline -> resolves (crisis default = refuse: stability drops, rel drops)
  ev = expirePetitions(uni, 1 + PETITION_DEADLINE_STEPS, () => 0.5);
  assert.equal(ev.length, 1);
  assert.equal(uni.civilizations[0].petition, null);
  assert.ok(uni.civilizations[0].relationship < 0.3);
});
