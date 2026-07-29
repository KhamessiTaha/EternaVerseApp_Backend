// tests/doctrineCatalog.test.js
const { test } = require("node:test");
const assert = require("node:assert");
const { DOCTRINES, doctrineModifiers, isValidDoctrine } = require("../utils/doctrineCatalog");

test("stock / null / unknown doctrine is all-neutral", () => {
  for (const d of [null, "none", undefined, "bogus"]) {
    const m = doctrineModifiers(d);
    assert.equal(m.thrust, 1);
    assert.equal(m.containment, 1);
    assert.equal(m.scanRange, 1);
  }
});

test("every doctrine has both boons and banes (real tradeoffs)", () => {
  for (const [id, doc] of Object.entries(DOCTRINES)) {
    assert.ok(doc.boons.length > 0, `${id} has boons`);
    assert.ok(doc.banes.length > 0, `${id} has banes`);
    // At least one effect > 1 and at least one < 1.
    const vals = Object.values(doc.effects);
    assert.ok(vals.some((v) => v > 1), `${id} has an upside`);
    assert.ok(vals.some((v) => v < 1), `${id} has a downside`);
  }
});

test("warden trades speed for containment reward", () => {
  const m = doctrineModifiers("warden");
  assert.ok(m.containment > 1.3, "big containment upside");
  assert.ok(m.maxSpeed < 1, "slower");
});

test("surveyor trades containment for scanning", () => {
  const m = doctrineModifiers("surveyor");
  assert.ok(m.scanRange > 1.3 && m.scanDuration < 1, "scans wide and fast");
  assert.ok(m.containment < 1, "weak at containment");
});

test("validation accepts known ids + none/null, rejects junk", () => {
  assert.ok(isValidDoctrine("warden"));
  assert.ok(isValidDoctrine("none"));
  assert.ok(isValidDoctrine(null));
  assert.ok(!isValidDoctrine("wizard"));
});
