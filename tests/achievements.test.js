// tests/achievements.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { CATALOG, evaluate, awardAchievements } = require("../utils/achievements");

test("catalog ids are unique", () => {
  const ids = CATALOG.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("evaluate returns only satisfied achievements", () => {
  const uni = {
    milestones: { firstGalaxy: true, firstStar: false },
    civilizations: [],
    research: { discoveryCount: 0, classesDiscovered: [] },
    metrics: { anomaliesResolved: 0 },
    upgrades: {},
    missions: [],
    currentState: { age: 0 },
  };
  const satisfied = evaluate(uni);
  assert.ok(satisfied.has("genesis"));
  assert.ok(!satisfied.has("first-light"));
  assert.equal(satisfied.size, 1);
});

test("a broken/missing field never throws, just fails that check", () => {
  const uni = {};
  assert.doesNotThrow(() => evaluate(uni));
});

test("well-equipped requires ALL four tracks maxed", () => {
  const base = { upgrades: { thrusters: 3, boostReactor: 3, scanner: 3, containment: 2 } };
  assert.ok(!evaluate(base).has("well-equipped"));
  base.upgrades.containment = 3;
  assert.ok(evaluate(base).has("well-equipped"));
});

test("awardAchievements only grants NEW ids and persists them", async () => {
  const saved = [];
  const fakeUser = {
    achievements: [{ id: "genesis" }],
    save: async () => saved.push([...fakeUser.achievements]),
  };
  const FakeUser = { findById: async () => ({ select: async () => fakeUser }) };
  // select() must be chainable synchronously in Mongoose usage; emulate that
  FakeUser.findById = () => ({ select: () => Promise.resolve(fakeUser) });

  const uni = { milestones: { firstGalaxy: true, firstStar: true } };
  const unlocked = await awardAchievements(FakeUser, "u1", uni);

  assert.equal(unlocked.length, 1);
  assert.equal(unlocked[0].id, "first-light");
  assert.equal(fakeUser.achievements.length, 2);
});

test("awardAchievements returns empty array and does not save when nothing new", async () => {
  let saveCalled = false;
  const fakeUser = {
    achievements: [{ id: "genesis" }],
    save: async () => { saveCalled = true; },
  };
  const FakeUser = { findById: () => ({ select: () => Promise.resolve(fakeUser) }) };

  const uni = { milestones: { firstGalaxy: true } };
  const unlocked = await awardAchievements(FakeUser, "u1", uni);

  assert.equal(unlocked.length, 0);
  assert.equal(saveCalled, false);
});
