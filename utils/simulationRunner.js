// utils/simulationRunner.js
//
// The core catch-up simulation, shared by two callers with identical
// semantics: the player-facing POST /:id/simulate route, and the cron sweep
// (routes/cron.js) that advances every running universe while nobody is
// online. Mutates the passed universe document (state, anomalies, events,
// timestamps, markModified flags) but never saves - persistence is the
// caller's job.
const PhysicsEngine = require("./physicsEngine");
const AnomalyGenerator = require("./anomalyGenerator");
const EndConditions = require("./endConditions");
const { recordEvent } = require("./eventLog");

// How much real-world time one simulation step represents. The universe
// advances based on wall-clock time since it was last simulated, capped at
// MAX_STEPS per call (~50 min of catch-up) so a long-abandoned universe
// can't make one request run unbounded work.
const SECONDS_PER_STEP = 30;
const MAX_STEPS = 100;

// Difficulty configuration
function difficultyOptions(difficulty) {
  const map = {
    Beginner: {
      timeStepYears: 5e7,
      anomalyProbabilityScale: 0.002,
      maxAnomalyPerStep: 1,
      observableGalaxiesMultiplier: 0.7,
      difficultyModifier: 0.5,
      description: "Relaxed pace, fewer anomalies, forgiving physics"
    },
    Intermediate: {
      timeStepYears: 2e7,
      anomalyProbabilityScale: 0.008,
      maxAnomalyPerStep: 3,
      observableGalaxiesMultiplier: 1.0,
      difficultyModifier: 1.0,
      description: "Balanced progression, moderate anomalies"
    },
    Advanced: {
      timeStepYears: 1e7,
      anomalyProbabilityScale: 0.02,
      maxAnomalyPerStep: 5,
      observableGalaxiesMultiplier: 1.3,
      difficultyModifier: 2.0,
      description: "Fast-paced, frequent anomalies, challenging physics"
    }
  };
  return map[difficulty] || map.Intermediate;
}

/**
 * Simulation randomness must not replay the same sequence every request
 * (seeding from uni.seed alone did exactly that). Mixing in the universe's
 * current age keeps it deterministic for a given state while advancing the
 * sequence as the universe evolves.
 */
function simulationSeed(uni) {
  return `${uni.seed}:${uni.currentState?.age ?? 0}`;
}

/** Steps owed to this universe based on wall-clock time since last tick. */
function pendingSteps(uni, now = new Date()) {
  const lastSimulatedAt = uni.lastSimulatedAt || uni.lastModified || uni.createdAt || now;
  const elapsedSeconds = Math.max(0, (now - lastSimulatedAt) / 1000);
  return Math.min(MAX_STEPS, Math.floor(elapsedSeconds / SECONDS_PER_STEP));
}

/**
 * Run the full simulation pipeline for however many steps this universe is
 * owed. Returns { steps: 0 } when no full step has elapsed yet; otherwise
 * { steps, createdAnomalies, Physics, AnomalyGen, EndChecker } so callers
 * can pull stats/warnings from the same engine instances that ran.
 */
function advanceUniverse(uni, now = new Date()) {
  const steps = pendingSteps(uni, now);
  if (steps <= 0) {
    return { steps: 0, createdAnomalies: [] };
  }

  const diffOpts = difficultyOptions(uni.difficulty || "Intermediate");

  // Apply observableGalaxies multiplier
  if (!uni.constants) uni.constants = {};
  uni.constants.observableGalaxies = 2e11 * diffOpts.observableGalaxiesMultiplier;

  const playerPosition = uni.lastPlayerPosition || { x: 0, y: 0 };
  const stepSeed = simulationSeed(uni);

  const Physics = new PhysicsEngine(uni, {
    timeStepYears: diffOpts.timeStepYears,
    difficultyModifier: diffOpts.difficultyModifier,
    seed: stepSeed
  });

  const AnomalyGen = new AnomalyGenerator(uni, {
    anomalyProbabilityScale: diffOpts.anomalyProbabilityScale,
    maxAnomalyPerStep: diffOpts.maxAnomalyPerStep,
    difficultyModifier: diffOpts.difficultyModifier,
    seed: stepSeed,
    playerPosition,
    anomalyIdFactory: () => `${uni._id.toString()}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
  });

  const EndChecker = new EndConditions(uni, {
    difficultyModifier: diffOpts.difficultyModifier
  });

  const createdAnomalies = [];

  for (let i = 0; i < steps; i++) {
    Physics.simulateStep();

    const newAnomalies = AnomalyGen.generateAnomalies();
    if (newAnomalies.length > 0) {
      for (const anomaly of newAnomalies) {
        AnomalyGen.applyAnomalyEffects(anomaly.effectsRaw);
        recordEvent(uni, {
          type: anomaly.type,
          description: anomaly.description,
          effects: anomaly.effectsRaw
        });
      }
      uni.anomalies.push(...newAnomalies);
      createdAnomalies.push(...newAnomalies);
    }

    AnomalyGen.decayUnresolvedAnomalies();
    Physics._updateStability();

    EndChecker.options.stabilityHistory = Physics.getStabilityHistory();
    if (EndChecker.checkEndConditions()) {
      recordEvent(uni, {
        type: "universe_end",
        description: uni.endReason
      });
      break;
    }
  }

  // Mark arrays as modified for Mongoose
  if (createdAnomalies.length > 0) uni.markModified("anomalies");
  if (uni.significantEvents.length > 0) uni.markModified("significantEvents");
  if (uni.civilizations.length > 0) uni.markModified("civilizations");
  uni.markModified("currentState");
  uni.markModified("metrics");

  uni.lastModified = now;
  uni.lastSimulatedAt = now;

  return { steps, createdAnomalies, Physics, AnomalyGen, EndChecker };
}

module.exports = {
  SECONDS_PER_STEP,
  MAX_STEPS,
  difficultyOptions,
  simulationSeed,
  pendingSteps,
  advanceUniverse
};
