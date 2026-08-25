// tests/leaderboard.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRunEntry, rankRuns, placeOf, ordinal,
} = require("../utils/leaderboard");

const chronicle = (over = {}) => ({
  shareCode: "KX7-2291",
  shareCodeReproducible: true,
  name: "First Light",
  difficulty: "Intermediate",
  finalAgeGyr: 24.5,
  civilizationsRescued: 2,
  civilizationsLost: 1,
  ascended: [],
  endCondition: "heat-death",
  endedAt: new Date("2026-03-01"),
  ...over,
});

const uni = (c, id = "uni_1") => ({ _id: { toString: () => id }, name: "First Light", chronicle: c });
const user = { _id: { toString: () => "u1" }, username: "taha" };

const run = (over = {}) => ({
  shareCode: "KX7-2291", universeId: "x", userId: "u", username: "w",
  ascensions: 0, rescued: 0, finalAgeGyr: 0, endedAt: new Date("2026-01-01"),
  ...over,
});

// --- what counts as better ----------------------------------------------

test("raising a species beats everything else", () => {
  const ranked = rankRuns([
    run({ universeId: "idler", finalAgeGyr: 200, rescued: 9 }),
    run({ universeId: "shepherd", ascensions: 1, finalAgeGyr: 8 }),
  ]);
  assert.equal(ranked[0].universeId, "shepherd");
});

test("saving worlds beats surviving longer", () => {
  // A ladder that ranked age above rescues would teach players to idle.
  const ranked = rankRuns([
    run({ universeId: "old", finalAgeGyr: 180 }),
    run({ universeId: "hero", rescued: 3, finalAgeGyr: 12 }),
  ]);
  assert.equal(ranked[0].universeId, "hero");
});

test("age only decides when nothing else does", () => {
  const ranked = rankRuns([
    run({ universeId: "short", ascensions: 2, rescued: 1, finalAgeGyr: 20 }),
    run({ universeId: "long", ascensions: 2, rescued: 1, finalAgeGyr: 90 }),
  ]);
  assert.equal(ranked[0].universeId, "long");
});

test("a board never reshuffles between reads", () => {
  // Identical runs must still have a stable order, or a player's place would
  // change every time they looked at it.
  const a = run({ universeId: "a", endedAt: new Date("2026-01-01") });
  const b = run({ universeId: "b", endedAt: new Date("2026-02-01") });
  assert.deepEqual(rankRuns([a, b]).map((r) => r.universeId), ["a", "b"]);
  assert.deepEqual(rankRuns([b, a]).map((r) => r.universeId), ["a", "b"]);
});

test("ranking does not mutate the board it was given", () => {
  const board = [run({ universeId: "a" }), run({ universeId: "b", ascensions: 5 })];
  const copy = [...board];
  rankRuns(board);
  assert.deepEqual(board, copy);
});

// --- placement -----------------------------------------------------------

test("place is 1-based and reads correctly", () => {
  const board = [
    run({ universeId: "first", ascensions: 3 }),
    run({ universeId: "second", ascensions: 2 }),
    run({ universeId: "third", ascensions: 1 }),
  ];
  assert.equal(placeOf(board, "first"), 1);
  assert.equal(placeOf(board, "third"), 3);
  assert.equal(placeOf(board, "not-here"), null);
});

test("ordinals read like English", () => {
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(2), "2nd");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(4), "4th");
  assert.equal(ordinal(11), "11th");
  assert.equal(ordinal(21), "21st");
  assert.equal(ordinal(0), null);
});

// --- what gets on the board ---------------------------------------------

test("a finished universe becomes a run", () => {
  const entry = buildRunEntry(uni(chronicle({ ascended: [{ civId: "c1" }] })), user);
  assert.equal(entry.shareCode, "KX7-2291");
  assert.equal(entry.ascensions, 1);
  assert.equal(entry.rescued, 2);
  assert.equal(entry.finalAgeGyr, 24.5);
  assert.equal(entry.username, "taha");
  assert.equal(entry.universeId, "uni_1");
});

test("a universe that hasn't ended is not a run", () => {
  assert.equal(buildRunEntry({ _id: "x", chronicle: null }, user), null);
  assert.equal(buildRunEntry({ _id: "x" }, user), null);
});

test("a code that cannot rebuild its universe never reaches the board", () => {
  // A legacy universe's code identifies it but generates a DIFFERENT cosmos.
  // Letting those runs onto that code's board would rank people who never
  // played the same universe against each other.
  const legacy = uni(chronicle({ shareCodeReproducible: false }));
  assert.equal(buildRunEntry(legacy, user), null);
});

test("a missing user still produces a usable row", () => {
  const entry = buildRunEntry(uni(chronicle()), null);
  assert.ok(entry);
  assert.equal(entry.username, "a warden");
});
