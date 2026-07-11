// utils/minorAnomalies.js
//
// Minor anomalies: the chunk-seeded "field turbulence" the client generates
// procedurally (deterministic ids "chunkX:chunkY:index"). Until now their
// resolution was a client-side illusion - no RP, no mission credit, and
// they respawned on reload. This makes them REAL with the same trusted-id
// pattern as discoveries: the client names the anomaly, the server
// validates the id shape, dedups against persistent history, and computes
// all rewards. In-fiction: MINOR anomalies (ambient, small-but-real
// rewards) vs CRITICAL anomalies (physics-engine events, big effects).

const MINOR_ID_PATTERN = /^-?\d+:-?\d+:\d+$/;
const MAX_RESOLVED_STORED = 2000; // FIFO cap on the dedup history

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Same grade philosophy as critical anomalies, simplified
const performanceMultiplier = (accuracy) =>
  accuracy >= 90 ? 1.25 : accuracy >= 75 ? 1.1 : accuracy >= 50 ? 1.0 : 0.8;

/**
 * Validate + apply a minor anomaly resolution. Mutates the universe
 * (stability, research, metrics, dedup history); caller saves.
 */
function applyMinorResolution(universe, { anomalyId, severity, accuracy }, containmentBonusPerLevel = 0.08) {
  if (typeof anomalyId !== "string" || !MINOR_ID_PATTERN.test(anomalyId)) {
    return { ok: false, reason: "Invalid minor anomaly id" };
  }

  if (!Array.isArray(universe.resolvedMinorAnomalies)) universe.resolvedMinorAnomalies = [];
  if (universe.resolvedMinorAnomalies.includes(anomalyId)) {
    return { ok: false, reason: "Anomaly already resolved", duplicate: true };
  }

  const sev = clamp(Math.floor(Number(severity) || 1), 1, 3);
  const acc = clamp(Number(accuracy) || 70, 0, 100);
  const perf = performanceMultiplier(acc);
  const containment = 1 + (universe.upgrades?.containment || 0) * containmentBonusPerLevel;

  // Deliberately ~40% of a critical anomaly's impact - ambient work, real
  // but never a substitute for hunting the big ones
  const stabilityBoost = 0.002 * sev * perf * containment;
  const reward = Math.max(1, Math.round(3 * sev * perf));

  const cs = universe.currentState || {};
  cs.stabilityIndex = clamp((cs.stabilityIndex ?? 1) + stabilityBoost, 0, 1);

  if (!universe.research) universe.research = {};
  universe.research.points = (universe.research.points || 0) + reward;
  universe.research.totalEarned = (universe.research.totalEarned || 0) + reward;

  if (!universe.metrics) universe.metrics = {};
  universe.metrics.anomaliesResolved = (universe.metrics.anomaliesResolved || 0) + 1;
  universe.metrics.playerInterventions = (universe.metrics.playerInterventions || 0) + 1;

  universe.resolvedMinorAnomalies.push(anomalyId);
  if (universe.resolvedMinorAnomalies.length > MAX_RESOLVED_STORED) {
    universe.resolvedMinorAnomalies.splice(0, universe.resolvedMinorAnomalies.length - MAX_RESOLVED_STORED);
  }

  return { ok: true, reward, stabilityBoost, severity: sev };
}

module.exports = { applyMinorResolution, MINOR_ID_PATTERN, MAX_RESOLVED_STORED };
