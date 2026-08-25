// tests/chronicle.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildChronicle } = require("../utils/chronicle");

const makeUniverse = (over = {}) => ({
  name: "Test Cosmos",
  difficulty: "Intermediate",
  doctrine: "keeper",
  endCondition: "heat-death",
  endReason: "Universe reached 204.3 Gyr with energy exhausted",
  simStep: 412,
  currentState: {
    age: 204.3e9, galaxyCount: 1.2e11, starCount: 4.5e20,
    civilizationsCreated: 31,
  },
  metrics: { playerInterventions: 88, anomaliesResolved: 61 },
  research: { totalEarned: 5400, discoveryCount: 143 },
  civilizations: [
    { id: "c1", observed: true, extinct: false, rescues: 2 },
    { id: "c2", observed: true, extinct: true },
    { id: "c3", observed: false, relationship: 0.4, extinct: true },  // met via contact
    { id: "c4", observed: false, relationship: 0, extinct: true },    // never met
    { id: "c5", observed: false, relationship: 0, extinct: false },
  ],
  legacies: [
    { civId: "c1", designation: "Kepler-9 Ascendancy", ageGyr: "12.4", rescues: 2, uplifts: 1 },
  ],
  anomalies: [
    { resolved: true }, { resolved: true }, { resolved: false },
  ],
  ...over,
});

test("a chronicle records how far the universe got", () => {
  const c = buildChronicle(makeUniverse());
  assert.equal(c.finalAgeGyr, 204.3);
  assert.equal(c.endCondition, "heat-death");
  assert.equal(c.steps, 412);
  assert.equal(c.name, "Test Cosmos");
  assert.equal(c.difficulty, "Intermediate");
});

test("only civilizations you actually MET count as yours", () => {
  const c = buildChronicle(makeUniverse());
  // c1 (observed), c2 (observed), c3 (relationship) - not c4 or c5
  assert.equal(c.civilizationsMet, 3);
  // Of those, c2 and c3 died. c4 died too but was never part of your story.
  assert.equal(c.civilizationsLost, 2);
  assert.equal(c.civilizationsRescued, 1);
  assert.equal(c.civilizationsCreated, 31);
});

test("what ascended is recorded by name - it outlasts the universe", () => {
  const c = buildChronicle(makeUniverse());
  assert.equal(c.ascended.length, 1);
  assert.equal(c.ascended[0].designation, "Kepler-9 Ascendancy");
  assert.equal(c.ascended[0].rescues, 2);
});

test("it records what the player did with their hands", () => {
  const c = buildChronicle(makeUniverse());
  assert.equal(c.anomaliesResolved, 61);
  assert.equal(c.interventions, 88);
  assert.equal(c.researchEarned, 5400);
  assert.equal(c.discoveries, 143);
});

test("contained anomalies survive the pruning that deletes them", () => {
  // The bug: a player who contained dozens was told "anomalies contained: 0".
  // autoCleanup() drops resolved anomalies older than five minutes once the
  // array hits 200, so counting universe.anomalies only ever saw the last few
  // minutes of a whole run. At death, that is usually none.
  const pruned = makeUniverse();
  pruned.anomalies = [];                       // everything already culled
  pruned.metrics.anomaliesResolved = 61;

  assert.equal(buildChronicle(pruned).anomaliesResolved, 61);
});

test("minor anomalies count too - they never entered universe.anomalies", () => {
  // Minors are chunk-seeded client-side and tracked by id in
  // resolvedMinorAnomalies, so a filter over universe.anomalies never counted
  // a single one of them, at any point in a run.
  const u = makeUniverse();
  u.anomalies = [];
  u.resolvedMinorAnomalies = ["0:0:1", "0:0:2", "1:-3:0"];
  u.metrics.anomaliesResolved = 3; // both resolve paths increment this

  assert.equal(buildChronicle(u).anomaliesResolved, 3);
});

test("a universe with no metrics reports zero rather than throwing", () => {
  const u = makeUniverse();
  delete u.metrics;
  assert.equal(buildChronicle(u).anomaliesResolved, 0);
  assert.equal(buildChronicle(u).interventions, 0);
});

test("a bare document does not throw", () => {
  // This runs inside the simulation loop, where an exception costs the player
  // the entire tick - so every field has to default.
  const c = buildChronicle({});
  assert.equal(c.finalAgeGyr, 0);
  assert.equal(c.civilizationsMet, 0);
  assert.deepEqual(c.ascended, []);
  assert.equal(c.endCondition, null);
});

test("the timestamp is the one the caller passes, not wall-clock drift", () => {
  const when = new Date("2026-01-01T00:00:00Z");
  assert.equal(buildChronicle(makeUniverse(), when).endedAt, when);
});
