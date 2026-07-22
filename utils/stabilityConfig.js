// utils/stabilityConfig.js
//
// Single source of truth for the stability-as-a-resource model. Every number
// that shapes drain / regen / crisis / escalation / offline behavior lives
// here so balance tuning is a one-file edit. Shared by physicsEngine,
// anomalyGenerator, endConditions and simulationRunner.

module.exports = {
  // Reservoir dynamics (per simulation step)
  STABILITY_DRAIN_PER_SEVERITY: 0.006, // per active anomaly, per severity point
  STABILITY_REGEN: 0.010,              // toward the ceiling, when calm
  REGEN_ANOMALY_THRESHOLD: 1,          // regen only when active anomalies <= this
  RESOLVE_REFILL_PER_SEVERITY: 0.040,  // instant on resolve, x grade x upgrade (persists)

  // Ceiling = CEILING_BASE + CEILING_SPAN * cosmologyHealth  (in [0.5, 1.0])
  CEILING_BASE: 0.50,
  CEILING_SPAN: 0.50,

  // Crisis
  CRITICAL_THRESHOLD: 0.15,       // enter CRITICAL below this
  CRISIS_CLEAR_THRESHOLD: 0.25,   // clear CRITICAL above this (hysteresis band)
  CRITICAL_DRAIN_MULTIPLIER: 1.5, // drain accelerates while critical (online)

  // Escalation / spread
  ESCALATION_STEP_THRESHOLD: 15,  // steps unresolved between +1 severity ticks
  SPREAD_SEVERITY_MIN: 4,         // only sev >= this can spawn neighbors
  SPREAD_CHANCE_PER_STEP: 0.02,   // per eligible anomaly, per step

  // Offline (cron sweep)
  OFFLINE_DRAIN_SCALE: 0.4,       // reduced drain while unattended
  OFFLINE_FLOOR: 0.20,            // offline drain can't push below this

  // Per-difficulty stability scaling. Higher tiers drain faster, regen
  // weaker, and collapse after fewer sustained-critical steps.
  difficultyStability(difficulty) {
    const map = {
      Beginner:     { drainScale: 0.5, regenScale: 1.5, crisisWindow: 20 },
      Intermediate: { drainScale: 1.0, regenScale: 1.0, crisisWindow: 12 },
      Advanced:     { drainScale: 2.0, regenScale: 0.6, crisisWindow: 6 },
    };
    return map[difficulty] || map.Intermediate;
  },
};
