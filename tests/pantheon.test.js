// tests/pantheon.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newLegaciesFor, syncPantheon } = require("../utils/pantheon");

const makeUniverse = (legacies, over = {}) => ({
  _id: { toString: () => "uni_1" },
  name: "First Light",
  legacies,
  ...over,
});

const legacy = (civId, over = {}) => ({
  civId,
  designation: `Signal ${civId}`,
  ascendedAt: new Date("2026-01-01"),
  ageGyr: "12.40",
  uplifts: 3,
  rescues: 1,
  pacifies: 0,
  shepherdedFor: 4.2e9,
  ...over,
});

test("an ascension is copied out of the universe that produced it", () => {
  const uni = makeUniverse([legacy("civ_a")]);
  const { pantheon, added } = syncPantheon(uni, []);

  assert.equal(added.length, 1);
  assert.equal(pantheon.length, 1);
  assert.equal(pantheon[0].civId, "civ_a");
  assert.equal(pantheon[0].designation, "Signal civ_a");
  assert.equal(pantheon[0].uplifts, 3);
  // Where they rose travels with them - it's half the story.
  assert.equal(pantheon[0].universeId, "uni_1");
  assert.equal(pantheon[0].universeName, "First Light");
});

test("syncing twice does not duplicate - this runs on every tick", () => {
  const uni = makeUniverse([legacy("civ_a")]);
  const first = syncPantheon(uni, []);
  const second = syncPantheon(uni, first.pantheon);

  assert.equal(second.added.length, 0);
  assert.equal(second.pantheon.length, 1);
  // Unchanged means the SAME array, so the caller can skip the DB write.
  assert.equal(second.pantheon, first.pantheon);
});

test("the same civ id in a different universe is a different people", () => {
  // Civ ids are only unique within their own universe, so identity is the pair.
  const a = makeUniverse([legacy("civ_1")]);
  const b = makeUniverse([legacy("civ_1")], {
    _id: { toString: () => "uni_2" }, name: "Second Light",
  });

  const { pantheon } = syncPantheon(b, syncPantheon(a, []).pantheon);
  assert.equal(pantheon.length, 2);
  assert.deepEqual(pantheon.map((p) => p.universeName), ["First Light", "Second Light"]);
});

test("a new ascension joins an existing pantheon without disturbing it", () => {
  const uni = makeUniverse([legacy("civ_a")]);
  const { pantheon: one } = syncPantheon(uni, []);

  uni.legacies.push(legacy("civ_b"));
  const { pantheon: two, added } = syncPantheon(uni, one);

  assert.equal(added.length, 1);
  assert.equal(added[0].civId, "civ_b");
  assert.deepEqual(two.map((p) => p.civId), ["civ_a", "civ_b"]);
});

test("a universe with nothing to give changes nothing", () => {
  const existing = [{ civId: "civ_x", universeId: "uni_old" }];
  const { pantheon, added } = syncPantheon(makeUniverse([]), existing);
  assert.equal(added.length, 0);
  assert.equal(pantheon, existing);
});

test("malformed legacies are skipped rather than poisoning the pantheon", () => {
  const uni = makeUniverse([{ designation: "no id at all" }, legacy("civ_ok")]);
  assert.deepEqual(newLegaciesFor(uni, []).map((l) => l.civId), ["civ_ok"]);
});
