// tests/discoveryValidator.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { prepareDiscoveries } = require("../utils/discoveryValidator");
const { OBJECT_CLASSES, ANOMALY_SCAN_BASE } = require("../utils/researchValues");

const uni = (over = {}) => ({ discoveries: [], anomalies: [], ...over });
const rawObj = (over = {}) => ({
  id: "obj:-3:12:4", name: "EVC 421", category: "galaxy",
  objectClass: "SBb", location: { x: -2500.5, y: 12100 }, ...over,
});

test("accepts a valid galaxy discovery and computes value server-side", () => {
  const { accepted, duplicates, rejected } = prepareDiscoveries(uni(), [rawObj()]);
  assert.equal(duplicates.length + rejected.length, 0);
  assert.equal(accepted.length, 1);
  const d = accepted[0];
  assert.equal(d.researchValue, OBJECT_CLASSES.SBb.research);
  assert.equal(d.rarity, OBJECT_CLASSES.SBb.rarity);
  assert.ok(d.discoveredAt instanceof Date);
});

test("rejects malformed ids, unknown classes, mismatched category, bad locations", () => {
  const cases = [
    rawObj({ id: "obj:x:1:2" }),
    rawObj({ objectClass: "Zz9" }),
    rawObj({ objectClass: "quasar" }),           // category says galaxy, class says phenomenon
    rawObj({ location: { x: Infinity, y: 0 } }),
    rawObj({ location: null }),
    { id: 42 },
  ];
  const { accepted, rejected } = prepareDiscoveries(uni(), cases);
  assert.equal(accepted.length, 0);
  assert.equal(rejected.length, 6);
});

test("dedups against stored discoveries and within the batch", () => {
  const stored = uni({ discoveries: [{ id: "obj:-3:12:4" }] });
  const { accepted, duplicates } = prepareDiscoveries(stored, [rawObj(), rawObj()]);
  assert.equal(accepted.length, 0);
  assert.deepEqual(duplicates, ["obj:-3:12:4", "obj:-3:12:4"]);
});

test("anomaly scans: id must exist in universe.anomalies; value = base x severity", () => {
  const u = uni({ anomalies: [{ id: "abc_123_9", type: "supernovaChain", severity: 3, resolved: false }] });
  const raw = { id: "abc_123_9", category: "anomaly", location: { x: 1, y: 2 } };
  const { accepted } = prepareDiscoveries(u, [raw]);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].researchValue, ANOMALY_SCAN_BASE * 3);
  assert.equal(accepted[0].objectClass, "supernovaChain");

  const { rejected } = prepareDiscoveries(u, [{ ...raw, id: "missing_1_2" }]);
  assert.equal(rejected.length, 1);
});

test("name is sanitized: non-strings and long names fall back", () => {
  const { accepted } = prepareDiscoveries(uni(), [rawObj({ name: "x".repeat(99) })]);
  assert.ok(accepted[0].name.length <= 32);
});
