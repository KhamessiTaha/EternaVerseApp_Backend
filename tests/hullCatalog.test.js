// tests/hullCatalog.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { HULL_CATALOG, COLOR_PALETTE, unlockedHullIds, validateLoadout } = require("../utils/hullCatalog");

test("catalog ids are unique and starter hull needs no achievement", () => {
  const ids = HULL_CATALOG.map((h) => h.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(HULL_CATALOG.find((h) => h.id === "interceptor").requiresAchievement, null);
});

test("unlockedHullIds only includes the starter hull for a fresh user", () => {
  const user = { achievements: [] };
  assert.deepEqual(unlockedHullIds(user), ["interceptor"]);
});

test("unlockedHullIds grows as achievements are earned", () => {
  const user = { achievements: [{ id: "first-light" }, { id: "not-alone" }] };
  const unlocked = unlockedHullIds(user);
  assert.ok(unlocked.includes("interceptor"));
  assert.ok(unlocked.includes("cutter"));
  assert.ok(unlocked.includes("cruiser"));
  assert.ok(!unlocked.includes("hauler"));
});

test("validateLoadout rejects a hull the user hasn't unlocked", () => {
  const user = { achievements: [] };
  const r = validateLoadout(user, "vanguard", COLOR_PALETTE[0]);
  assert.equal(r.ok, false);
});

test("validateLoadout accepts an unlocked hull with a valid color", () => {
  const user = { achievements: [{ id: "ascension" }] };
  const r = validateLoadout(user, "vanguard", COLOR_PALETTE[1]);
  assert.equal(r.ok, true);
});

test("validateLoadout rejects unknown hull ids and off-palette colors", () => {
  const user = { achievements: [] };
  assert.equal(validateLoadout(user, "does-not-exist", COLOR_PALETTE[0]).ok, false);
  assert.equal(validateLoadout(user, "interceptor", "#123456").ok, false);
});
