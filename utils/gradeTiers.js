// utils/gradeTiers.js
//
// Single server-side source for "how well did the player play that minigame,
// and what is it worth". Mirrors the frontend's GRADE_TIERS
// (src/components/game/utils.js) - that copy drives display and the client's
// preview number; this one decides what is actually awarded.
//
// This file exists because there were THREE copies of this idea and they had
// drifted: GRADE_TIERS on the client (S 1.3), PERFORMANCE_TIERS in
// anomalyGenerator (S 1.3), and a simplified ladder inside minorAnomalies
// (S-equivalent 1.25, different thresholds entirely). Widening the skill
// spread meant picking one of them, so now there is one.
//
// The spread: an S is worth 2.6x a B and 4.7x a C. B is pinned at exactly 1.0
// so the median player's economy is untouched - the gap widens by raising the
// ceiling and lowering the floor, not by inflating the whole curve.

const TIERS = [
  { min: 95, grade: "S", multiplier: 2.6 },
  { min: 85, grade: "A", multiplier: 1.6 },
  { min: 70, grade: "B", multiplier: 1.0 },
  { min: 50, grade: "C", multiplier: 0.55 },
  // Technically contained, but badly. Still some credit - a resolved anomaly
  // is a resolved anomaly, it just barely pays.
  { min: 0, grade: "F", multiplier: 0.2 },
];

/**
 * Research points a CRITICAL anomaly resolution is worth, per severity point,
 * before the grade and containment multipliers.
 *
 * Resolving a critical anomaly used to award NO research at all - the game's
 * headline containment act paid nothing in its main currency, while the
 * ambient minor anomalies paid 3/severity. At 8, a severity-3 contained at
 * grade B is 24 RP and the same anomaly contained flawlessly is 62.
 */
const RESOLVE_RP_PER_SEVERITY = 8;

/** Tier for a 0-100 accuracy. Unreported accuracy is never punished. */
function gradeFor(accuracy) {
  if (typeof accuracy !== "number" || Number.isNaN(accuracy)) {
    return { min: 70, grade: "B", multiplier: 1.0 };
  }
  const clamped = Math.max(0, Math.min(100, accuracy));
  return TIERS.find((t) => clamped >= t.min) || TIERS[TIERS.length - 1];
}

/** Just the multiplier, for callers that don't care about the letter. */
function performanceMultiplier(accuracy) {
  return gradeFor(accuracy).multiplier;
}

module.exports = { TIERS, gradeFor, performanceMultiplier, RESOLVE_RP_PER_SEVERITY };
