const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const PhysicsEngine = require("../utils/physicsEngine");
const AnomalyGenerator = require("../utils/anomalyGenerator");
const EndConditions = require("../utils/endConditions");
const MLPredictor = require("../utils/mlPredictor");
const Universe = require("../models/Universe");

router.use(verifyToken);

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

// Get all universes
router.get("/", async (req, res) => {
  try {
    const universes = await Universe.find({userId: req.user.id})
      .select('-anomalies -significantEvents -civilizations')
      .lean();
    
    return res.json({ ok: true, universes });
  } catch (err) {
    console.error("Get universes error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Create a new universe
router.post("/", async (req, res) => {
  try {
    const { name, seed, difficulty, constants, initialConditions } = req.body;

    const validDifficulties = ["Beginner", "Intermediate", "Advanced"];
    const selectedDifficulty = validDifficulties.includes(difficulty) ? difficulty : "Beginner";

    const universeConstants = {
      H0_km_s_Mpc: 67.4,
      speedOfLight: 2.99792458e8,
      gravitationalConstant: 6.6743e-11,
      darkMatterDensity: 0.26,
      darkEnergyDensity: 0.69,
      matterDensity: 0.05,
      observableGalaxies: 2e11,
      averageStarsPerGalaxy: 1e10,
      planckTemperature: 1.417e32,
      ...constants
    };

    const uni = new Universe({
      userId: req.user.id,
      name: name || `Universe-${Date.now()}`,
      seed: seed || Math.random().toString(36).slice(2),
      difficulty: selectedDifficulty,
      constants: universeConstants,
      initialConditions: {
        initialTemperature: initialConditions?.initialTemperature ?? 2.725
      }
    });

    uni.currentState = {
      age: 0,
      _scaleFactor: 1.0,
      expansionRate: universeConstants.H0_km_s_Mpc,
      temperature: initialConditions?.initialTemperature ?? 2.725,
      entropy: 0,
      stabilityIndex: 1.0,
      galaxyCount: 0,
      starCount: 0,
      blackHoleCount: 0,
      habitableSystemsCount: 0,
      lifeBearingPlanetsCount: 0,
      civilizationCount: 0
    };

    uni.metrics = {
      playerInterventions: 0,
      anomalyResolutionRate: 0,
      stabilityScore: 1.0,
      complexityIndex: 0,
      lifePotentialIndex: 0
    };

    uni.lastModified = new Date();

    await uni.save();
    
    console.log(`✅ Created universe: ${uni.name} [${selectedDifficulty}]`);
    
    return res.status(201).json({ ok: true, universe: uni });
  } catch (err) {
    console.error("Create universe error:", err);
    return res.status(500).json({ ok: false, error: "Failed to create universe" });
  }
});

// Get universe by ID
router.get("/:id", async (req, res) => {
  try {
    const uni = await Universe.findById(req.params.id).lean();
    if (!uni) return res.status(404).json({ ok: false, error: "Universe not found" });
    return res.json({ ok: true, universe: uni });
  } catch (err) {
    console.error("Get universe error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// How much real-world time one simulation step represents. The universe
// advances based on elapsed wall-clock time since it was last simulated,
// not based on whether any client happens to be polling - so it keeps
// aging (and catches up) even if nobody has the game open.
const SECONDS_PER_STEP = 30;
const MAX_STEPS = 100;

// simulate N steps with modular architecture
router.post("/:id/simulate", async (req, res) => {
  try {
    const uni = await Universe.findById(req.params.id);
    if (!uni) {
      return res.status(404).json({ ok: false, error: "Universe not found" });
    }

    if (uni.status === "ended") {
      return res.status(400).json({
        ok: false,
        error: "Universe already ended",
        endCondition: uni.endCondition,
        endReason: uni.endReason
      });
    }

    const now = new Date();
    const lastSimulatedAt = uni.lastSimulatedAt || uni.lastModified || uni.createdAt || now;
    const elapsedSeconds = Math.max(0, (now - lastSimulatedAt) / 1000);
    const steps = Math.min(MAX_STEPS, Math.floor(elapsedSeconds / SECONDS_PER_STEP));

    if (steps <= 0) {
      // Not enough real time has passed for a full step yet - avoid
      // re-running physics/anomalies/predictions for nothing.
      const Physics = new PhysicsEngine(uni, { seed: uni.seed });
      return res.json({
        ok: true,
        steps: 0,
        skipped: true,
        stats: Physics.getStatistics(),
        createdAnomalies: [],
        hasEnded: uni.status === "ended",
        endCondition: uni.endCondition,
        endReason: uni.endReason,
        universe: uni
      });
    }

    // Get difficulty-specific options
    const diffOpts = difficultyOptions(uni.difficulty || "Intermediate");

    // Apply observableGalaxies multiplier
    if (!uni.constants) uni.constants = {};
    const baseGalaxies = 2e11;
    uni.constants.observableGalaxies = baseGalaxies * diffOpts.observableGalaxiesMultiplier;

    // Player position drives where anomalies spawn - persist whatever the
    // client last reported, and fall back to that if this call doesn't send one
    // (e.g. background simulation ticks fired without a fresh position).
    const incomingPosition = req.body.playerPosition;
    if (
      incomingPosition &&
      typeof incomingPosition.x === "number" &&
      typeof incomingPosition.y === "number"
    ) {
      uni.lastPlayerPosition = { x: incomingPosition.x, y: incomingPosition.y };
    }
    const playerPosition = uni.lastPlayerPosition || { x: 0, y: 0 };

    // Build options with difficulty modifier
    const engineOptions = {
      timeStepYears: diffOpts.timeStepYears,
      difficultyModifier: diffOpts.difficultyModifier,
      seed: uni.seed
    };

    const anomalyOptions = {
      anomalyProbabilityScale: diffOpts.anomalyProbabilityScale,
      maxAnomalyPerStep: diffOpts.maxAnomalyPerStep,
      difficultyModifier: diffOpts.difficultyModifier,
      seed: uni.seed,
      playerPosition,
      anomalyIdFactory: () => `${uni._id.toString()}_${Date.now()}_${Math.floor(Math.random()*1e6)}`
    };

    // ========== MODULAR SIMULATION PIPELINE ==========
    
    // 1 ------ Create Physics Engine
    const Physics = new PhysicsEngine(uni, engineOptions);

    // 2 ------ Create Anomaly Generator
    const AnomalyGen = new AnomalyGenerator(uni, anomalyOptions);

    // 3 ------ Create End Conditions Checker
    const EndChecker = new EndConditions(uni, {
      difficultyModifier: diffOpts.difficultyModifier
    });

    // 4 ------- Create ML Predictor
    const Predictor = new MLPredictor(uni);

    // all created anomalies
    const allCreatedAnomalies = [];

    // Simulate steps §§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§§!
    for (let i = 0; i < steps; i++) {
      // physics simulation
      Physics.simulateStep();
      // generate anomalies
      const newAnomalies = AnomalyGen.generateAnomalies();
      
      if (newAnomalies.length > 0) {
        // Apply anomaly effects to universe state
        for (const anomaly of newAnomalies) {
          AnomalyGen.applyAnomalyEffects(anomaly.effectsRaw);
          
          // Record event
          if (uni.significantEvents.length < 2000) {
            uni.significantEvents.push({
              timestamp: new Date(),
              age: uni.currentState.age,
              type: anomaly.type,
              description: anomaly.description,
              effects: anomaly.effectsRaw,
              ageGyr: (uni.currentState.age / 1e9).toFixed(3)
            });
          }
        }
        
        // Add to universe anomalies array
        uni.anomalies.push(...newAnomalies);
        allCreatedAnomalies.push(...newAnomalies);
      }

      // C. Decay unresolved anomalies
      AnomalyGen.decayUnresolvedAnomalies();

      // D. Update stability after anomaly effects
      Physics._updateStability();

      // E. Check end conditions
      EndChecker.options.stabilityHistory = Physics.getStabilityHistory();
      const hasEnded = EndChecker.checkEndConditions();
      
      if (hasEnded) {
        // Record end event
        uni.significantEvents.push({
          timestamp: new Date(),
          age: uni.currentState.age,
          type: "universe_end",
          description: uni.endReason,
          effects: {},
          ageGyr: (uni.currentState.age / 1e9).toFixed(3)
        });
        break;
      }
    }

    // F. Run ML predictions (after simulation)
    const predictions = Predictor.generatePredictions();

    // Mark arrays as modified for Mongoose
    if (allCreatedAnomalies.length > 0) {
      uni.markModified('anomalies');
      console.log(`🌌 Created ${allCreatedAnomalies.length} new anomalies`);
    }
    if (uni.significantEvents.length > 0) {
      uni.markModified('significantEvents');
    }
    if (uni.civilizations.length > 0) {
      uni.markModified('civilizations');
    }
    uni.markModified('currentState');
    uni.markModified('metrics');

    // Update timestamps
    uni.lastModified = now;
    uni.lastSimulatedAt = now;

    // Save with error handling
    try {
      await uni.save();
    } catch (saveErr) {
      console.error("Save error:", saveErr);
      return res.status(500).json({
        ok: false,
        error: "Failed to save simulation state",
        details: saveErr.message
      });
    }

    const stats = Physics.getStatistics();
    const anomalyStats = AnomalyGen.getAnomalyStats();
    const endStatus = EndChecker.getEndConditionStatus();
    const warnings = EndChecker.getWarnings();
    
    // Log simulation results
    console.log(
      `🎮 Simulated ${steps} steps | ` +
      `Age: ${stats.ageGyr} Gyr | ` +
      `Stability: ${stats.stability} | ` +
      `Anomalies: ${anomalyStats.active}/${anomalyStats.total}`
    );

    if (uni.status === "ended") {
      console.log(`🌑 Universe ended: ${uni.endCondition} - ${uni.endReason}`);
    }
    
    return res.json({ 
      ok: true, 
      steps, 
      stats,
      anomalyStats,
      endStatus,
      warnings,
      predictions,
      createdAnomalies: allCreatedAnomalies,
      hasEnded: uni.status === "ended",
      endCondition: uni.endCondition,
      endReason: uni.endReason,
      universe: uni 
    });
  } catch (err) {
    console.error("Simulate error:", err);
    return res.status(500).json({ 
      ok: false, 
      error: err.message || "Simulation error" 
    });
  }
});

// Delete a universe
router.delete("/:id", async (req, res) => {
  try {
    const uni = await Universe.findById(req.params.id);

    if (!uni) {
      return res.status(404).json({ ok: false, error: "Universe not found" });
    }

    await uni.deleteOne();

    console.log(`🗑️ Deleted universe: ${uni.name}`);

    return res.json({ ok: true, message: "Universe deleted successfully" });
  } catch (err) {
    console.error("Delete universe error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Resolve anomaly with modular architecture
router.post("/:id/resolve-anomaly", async (req, res) => {
  try {
    const { anomalyId, accuracy } = req.body;

    if (!anomalyId) {
      return res.status(400).json({ ok: false, error: "anomalyId required" });
    }

    const uni = await Universe.findById(req.params.id);

    if (!uni) {
      return res.status(404).json({ ok: false, error: "Universe not found" });
    }

    if (uni.status === "ended") {
      return res.status(400).json({
        ok: false,
        error: "Cannot resolve anomalies in ended universe"
      });
    }

    // Create anomaly generator to resolve
    const AnomalyGen = new AnomalyGenerator(uni, { seed: uni.seed });

    // Resolve anomaly - accuracy (0-100, from the minigame's performance grade)
    // scales the reward; resolveAnomaly() clamps/validates it internally
    const result = AnomalyGen.resolveAnomaly(anomalyId, accuracy);

    if (!result.success) {
      return res.status(400).json({
        ok: false,
        error: result.reason
      });
    }


    // Record event
    if (uni.significantEvents.length < 2000) {
      const precisionNote = result.accuracy !== null ? ` at ${result.accuracy.toFixed(0)}% precision` : "";
      uni.significantEvents.push({
        timestamp: new Date(),
        age: uni.currentState.age,
        type: "anomaly_resolved",
        description: `Resolved ${result.anomaly.type} anomaly (severity ${result.anomaly.severity})${precisionNote}`,
        effects: {
          anomalyId,
          category: result.anomaly.category,
          severityResolved: result.anomaly.severity,
          stabilityBoost: result.stabilityBoost,
          entropyReduction: result.entropyReduction,
          performanceMultiplier: result.performanceMultiplier,
          accuracy: result.accuracy
        },
        ageGyr: (uni.currentState.age / 1e9).toFixed(3)
      });
    }

    // Mark arrays as modified
    uni.markModified('anomalies');
    uni.markModified('currentState');
    uni.markModified('metrics');
    uni.markModified('significantEvents');
    
    uni.lastModified = new Date();
    
    await uni.save();

    // Get updated stats
    const Physics = new PhysicsEngine(uni, { seed: uni.seed });
    const stats = Physics.getStatistics();
    
    console.log(`✅ Resolved anomaly ${anomalyId} | Stability: ${stats.stability} (+${(result.stabilityBoost * 100).toFixed(2)}%) | Performance: ${result.accuracy !== null ? result.accuracy.toFixed(0) + '%' : 'n/a'} (x${result.performanceMultiplier})`);

    return res.json({
      ok: true,
      anomalyId,
      stabilityBoost: result.stabilityBoost,
      entropyReduction: result.entropyReduction,
      performanceMultiplier: result.performanceMultiplier,
      accuracy: result.accuracy,
      universe: uni,
      stats
    });
  } catch (err) {
    console.error("Resolve anomaly error:", err);
    return res.status(500).json({ 
      ok: false, 
      error: err.message || "Failed to resolve anomaly" 
    });
  }
});

// Get engine stats without mutating model
router.get("/:id/stats", async (req, res) => {
  try {
    const uni = await Universe.findById(req.params.id).lean();
    
    if (!uni) {
      return res.status(404).json({ ok: false, error: "Universe not found" });
    }

    const Physics = new PhysicsEngine(uni, { seed: uni.seed });
    const stats = Physics.getStatistics();
    
    return res.json({ ok: true, stats });
  } catch (err) {
    console.error("Get stats error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Get all anomalies for a universe
router.get("/:id/anomalies", async (req, res) => {
  try {
    const uni = await Universe.findById(req.params.id)
      .select('anomalies')
      .lean();
    
    if (!uni) {
      return res.status(404).json({ ok: false, error: "Universe not found" });
    }

    const anomalies = uni.anomalies || [];
    const active = anomalies.filter(a => !a.resolved);
    const resolved = anomalies.filter(a => a.resolved);

    return res.json({ 
      ok: true, 
      anomalies,
      active,
      resolved,
      counts: {
        total: anomalies.length,
        active: active.length,
        resolved: resolved.length
      }
    });
  } catch (err) {
    console.error("Get anomalies error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Get ML predictions
router.get("/:id/predictions", async (req, res) => {
  try {
    const uni = await Universe.findById(req.params.id).lean();
    
    if (!uni) {
      return res.status(404).json({ ok: false, error: "Universe not found" });
    }

    const Predictor = new MLPredictor(uni);
    const predictions = Predictor.generatePredictions();
    
    return res.json({ ok: true, predictions });
  } catch (err) {
    console.error("Get predictions error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Get end condition status
router.get("/:id/end-conditions", async (req, res) => {
  try {
    const uni = await Universe.findById(req.params.id).lean();
    
    if (!uni) {
      return res.status(404).json({ ok: false, error: "Universe not found" });
    }

    const diffOpts = difficultyOptions(uni.difficulty || "Intermediate");
    const EndChecker = new EndConditions(uni, {
      difficultyModifier: diffOpts.difficultyModifier
    });
    
    const status = EndChecker.getEndConditionStatus();
    const warnings = EndChecker.getWarnings();
    
    return res.json({ ok: true, status, warnings });
  } catch (err) {
    console.error("Get end conditions error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Bulk cleanup resolved anomalies
router.post("/:id/cleanup-anomalies", async (req, res) => {
  try {
    const { keepRecentMinutes = 60 } = req.body;
    
    const uni = await Universe.findById(req.params.id);
    
    if (!uni) {
      return res.status(404).json({ ok: false, error: "Universe not found" });
    }

    const cutoffTime = Date.now() - keepRecentMinutes * 60 * 1000;
    const before = uni.anomalies.length;
    
    uni.anomalies = uni.anomalies.filter(a => 
      !a.resolved || new Date(a.resolvedAt || a.timestamp).getTime() > cutoffTime
    );
    
    const removed = before - uni.anomalies.length;
    
    if (removed > 0) {
      uni.markModified('anomalies');
      uni.lastModified = new Date();
      await uni.save();
      
      console.log(`🧹 Cleaned ${removed} old resolved anomalies from ${uni.name}`);
    }

    return res.json({ 
      ok: true, 
      removed,
      remaining: uni.anomalies.length 
    });
  } catch (err) {
    console.error("Cleanup anomalies error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;