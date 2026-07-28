// tests/legacyArc.test.js
//
// The Ascendant / post-Legacy arc: when the player's chosen species reaches
// Type III it ascends - an immortal legacy is recorded, the civ is marked a
// benefactor, and the mantle (chosenCivId) is freed so another can be chosen.
// Ascended peoples then pay a "shepherd's dividend" forward.
//
// These exercise the helpers directly (deterministic) rather than the rare
// RNG-gated transition, so the arc's contract is verified without flakiness.

const { test } = require("node:test");
const assert = require("node:assert");
const PhysicsEngine = require("../utils/physicsEngine");

function makeUniverse(overrides = {}) {
  return {
    seed: "legacy-test-seed",
    currentState: { age: 12e9 },
    research: { points: 100, totalEarned: 100 },
    significantEvents: [],
    milestones: {},
    chosenCivId: null,
    legacies: [],
    civilizations: [],
    ...overrides,
  };
}

function makeCiv(id, extra = {}) {
  return {
    id,
    type: "Type2",
    age: 3.5e9,
    uplifts: 2,
    rescues: 1,
    pacifies: 1,
    extinct: false,
    ascended: false,
    stability: 0.6,
    resourceDepletion: 0.1,
    ...extra,
  };
}

test("_recordLegacy records the chosen people and frees the mantle", () => {
  const civ = makeCiv("chosen-a");
  const universe = makeUniverse({ chosenCivId: "chosen-a", civilizations: [civ] });
  const engine = new PhysicsEngine(universe);

  engine._recordLegacy(civ);

  assert.strictEqual(civ.ascended, true, "civ is marked ascended");
  assert.strictEqual(universe.chosenCivId, null, "mantle is freed for a new choice");
  assert.strictEqual(universe.legacies.length, 1, "one legacy recorded");

  const legacy = universe.legacies[0];
  assert.strictEqual(legacy.civId, "chosen-a");
  assert.strictEqual(legacy.uplifts, 2);
  assert.strictEqual(legacy.rescues, 1);
  assert.strictEqual(legacy.pacifies, 1);
  assert.strictEqual(legacy.shepherdedFor, 3.5e9);
  assert.ok(legacy.designation, "a display designation is captured");
  assert.strictEqual(legacy.ageGyr, "12.00", "universe age at ascension is captured");
});

test("_recordLegacy is idempotent and ignores non-chosen civs", () => {
  const chosen = makeCiv("chosen-b");
  const other = makeCiv("other-b");
  const universe = makeUniverse({ chosenCivId: "chosen-b", civilizations: [chosen, other] });
  const engine = new PhysicsEngine(universe);

  engine._recordLegacy(other); // not the chosen -> ignored
  assert.strictEqual(universe.legacies.length, 0);
  assert.strictEqual(other.ascended, false);

  engine._recordLegacy(chosen);
  engine._recordLegacy(chosen); // already ascended + mantle freed -> no dupe
  assert.strictEqual(universe.legacies.length, 1, "no duplicate legacy");
});

test("shepherd's dividend gifts RP back to the player", () => {
  const civ = makeCiv("ascended-c", { ascended: true });
  const universe = makeUniverse({ civilizations: [civ] });
  const engine = new PhysicsEngine(universe);
  engine._rand = () => 0.0; // force the RP-gift branch (0 < 0.03)

  const before = universe.research.points;
  engine._ascendantDividend(civ);
  assert.ok(universe.research.points > before, "research points increased");
  assert.ok(
    universe.significantEvents.some((e) => /send knowledge back/i.test(e.description)),
    "a dividend event was logged"
  );
});

test("ascended intervene to steady a failing neighbor", () => {
  const ascended = makeCiv("ascended-d", { ascended: true });
  const failing = makeCiv("failing-d", { stability: 0.15, resourceDepletion: 0.85 });
  const universe = makeUniverse({ civilizations: [ascended, failing] });
  const engine = new PhysicsEngine(universe);

  // Skip the RP branch (0.5 >= 0.03), hit the aid branch (0.005 < 0.01).
  const seq = [0.5, 0.005];
  let i = 0;
  engine._rand = () => seq[i++] ?? 0.9;

  engine._ascendantDividend(ascended);
  assert.ok(failing.stability > 0.15, "failing neighbor's stability improved");
  assert.ok(failing.resourceDepletion < 0.85, "failing neighbor's depletion eased");
  assert.ok(
    universe.significantEvents.some((e) => /descend to steady/i.test(e.description)),
    "an intervention event was logged"
  );
});

test("dividend is inert for non-ascended or extinct civs", () => {
  const universe = makeUniverse();
  const engine = new PhysicsEngine(universe);
  engine._rand = () => 0.0;

  const before = universe.research.points;
  engine._ascendantDividend(makeCiv("plain-e", { ascended: false }));
  engine._ascendantDividend(makeCiv("dead-e", { ascended: true, extinct: true }));
  assert.strictEqual(universe.research.points, before, "no RP granted");
});
