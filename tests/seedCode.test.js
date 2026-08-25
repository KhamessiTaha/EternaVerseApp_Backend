// tests/seedCode.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ALPHA, isShareCode, normalizeCode, generateCode, codeForSeed, seedForCode,
} = require("../utils/seedCode");

test("a generated code is valid, and is its own seed", () => {
  // The property the whole feature rests on: typing a friend's code must
  // build the identical cosmos, with no shared lookup table anywhere.
  for (let i = 0; i < 200; i++) {
    const code = generateCode();
    assert.ok(isShareCode(code), code);
    assert.equal(seedForCode(code), code, "the code IS the seed");
    assert.equal(codeForSeed(code).code, code);
    assert.equal(codeForSeed(code).reproducible, true);
  }
});

test("the alphabet excludes every character people mistype", () => {
  // I/O/0/1 are what get read wrong off a screenshot.
  for (const c of ["I", "O", "0", "1"]) {
    assert.ok(!ALPHA.includes(c), `${c} should not be in the alphabet`);
  }
});

test("input is forgiving about case, spaces and the dash", () => {
  const target = "KX7-2291";
  for (const typed of ["KX7-2291", "kx7-2291", "KX72291", "kx7 2291", " KX7--2291 ", "Kx7_2291"]) {
    assert.equal(normalizeCode(typed), target, `failed on "${typed}"`);
  }
});

test("nonsense is rejected rather than silently making a universe", () => {
  for (const bad of [
    "", "ABC", "ABC-12345", "ABC-ABCD", "AB1-2291", "IOO-2291",
    "TOO-LONG-HERE", null, undefined, 42, {},
  ]) {
    assert.equal(normalizeCode(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("a code with an excluded letter is refused", () => {
  // O and 0 look identical in most fonts; accepting one would hand the player
  // a different universe than the one they were shown.
  assert.equal(normalizeCode("KO7-2291"), null);
  assert.equal(normalizeCode("KI7-2291"), null);
});

test("legacy seeds get a stable code, flagged as not reproducible", () => {
  // Universes made before share codes have long random seeds that cannot fit
  // in seven characters. Telling a player to share a code that won't rebuild
  // their universe would be worse than telling them nothing.
  const legacy = "k3j4h5g6f7d8s9a";
  const a = codeForSeed(legacy);
  const b = codeForSeed(legacy);

  assert.ok(isShareCode(a.code));
  assert.equal(a.code, b.code, "must be stable across calls");
  assert.equal(a.reproducible, false);
});

test("different legacy seeds get different codes", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(codeForSeed(`legacy-seed-${i}`).code);
  // Not a cryptographic guarantee, just a sanity check that the hash spreads.
  assert.ok(seen.size > 480, `only ${seen.size} distinct codes from 500 seeds`);
});

test("generation spreads across the space", () => {
  let n = 0;
  const rng = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  const seen = new Set();
  for (let i = 0; i < 300; i++) seen.add(generateCode(rng));
  assert.ok(seen.size > 250, `only ${seen.size} distinct codes`);
});

test("codeForSeed survives a missing seed", () => {
  for (const junk of [null, undefined, "", 0]) {
    assert.ok(isShareCode(codeForSeed(junk).code), String(junk));
  }
});
