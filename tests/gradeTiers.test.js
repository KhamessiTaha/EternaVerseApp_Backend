// tests/gradeTiers.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  TIERS, gradeFor, performanceMultiplier, RESOLVE_RP_PER_SEVERITY,
} = require("../utils/gradeTiers");

test("a flawless run is worth ~2.6x an adequate one", () => {
  // The whole point of widening the ladder: seven physics minigames existed
  // and the gap between flawless and adequate was 1.3 vs 1.0.
  const s = performanceMultiplier(100);
  const b = performanceMultiplier(75);
  assert.ok(s / b >= 2.5 && s / b <= 3.0, `S:B was ${s / b}`);
});

test("B is pinned at exactly 1.0 so the median economy is unchanged", () => {
  // The spread widens by raising the ceiling and lowering the floor, NOT by
  // inflating the curve - otherwise every existing balance number shifts.
  assert.equal(performanceMultiplier(70), 1.0);
  assert.equal(performanceMultiplier(84), 1.0);
});

test("grades are monotonic and cover every accuracy", () => {
  let last = Infinity;
  for (const t of TIERS) {
    assert.ok(t.multiplier <= last, `${t.grade} breaks monotonicity`);
    last = t.multiplier;
  }
  for (let acc = 0; acc <= 100; acc += 1) {
    const g = gradeFor(acc);
    assert.ok(g && typeof g.multiplier === "number", `no grade for ${acc}`);
  }
});

test("the letter boundaries are where the player is told they are", () => {
  assert.equal(gradeFor(95).grade, "S");
  assert.equal(gradeFor(94.9).grade, "A");
  assert.equal(gradeFor(85).grade, "A");
  assert.equal(gradeFor(70).grade, "B");
  assert.equal(gradeFor(50).grade, "C");
  assert.equal(gradeFor(49).grade, "F");
});

test("a sloppy containment still pays something", () => {
  // A resolved anomaly is resolved. It just barely pays.
  assert.ok(performanceMultiplier(10) > 0);
  assert.ok(performanceMultiplier(10) < performanceMultiplier(60));
});

test("an unreported accuracy is never punished", () => {
  // Older clients, or a resolve path that doesn't measure - treat as adequate.
  assert.equal(performanceMultiplier(undefined), 1.0);
  assert.equal(performanceMultiplier(NaN), 1.0);
  assert.equal(performanceMultiplier("nonsense"), 1.0);
});

test("accuracy is clamped, so a tampered 900% buys nothing extra", () => {
  assert.equal(performanceMultiplier(900), performanceMultiplier(100));
  assert.equal(performanceMultiplier(-50), performanceMultiplier(0));
});

test("containing a critical anomaly is worth real research", () => {
  // It paid ZERO before - the headline containment act awarded none of the
  // game's main currency.
  assert.ok(RESOLVE_RP_PER_SEVERITY > 0);
  const b = RESOLVE_RP_PER_SEVERITY * 3 * performanceMultiplier(75);
  const s = RESOLVE_RP_PER_SEVERITY * 3 * performanceMultiplier(100);
  assert.equal(Math.round(b), 24);
  assert.equal(Math.round(s), 62);
});
