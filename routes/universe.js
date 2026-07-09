const express = require("express");
const router = express.Router();
const verifyToken = require("../middleware/authMiddleware");
const PhysicsEngine = require("../utils/physicsEngine");
const AnomalyGenerator = require("../utils/anomalyGenerator");
const EndConditions = require("../utils/endConditions");
const MLPredictor = require("../utils/mlPredictor");
const Universe = require("../models/Universe");
const { recordEvent } = require("../utils/eventLog");
const { prepareDiscoveries } = require("../utils/discoveryValidator");
const { validatePurchase, CONTAINMENT_BONUS_PER_LEVEL } = require("../utils/upgradeCatalog");

router.use(verifyToken);

/**
 * Load a universe by id and verify it belongs to the authenticated user.
 * Responds with 404 (and returns null) when missing OR owned by someone
 * else - deliberately the same status for both, so universe ids can't be
 * probed for existence.
 *
 * `select`, when provided, must include userId for the ownership check.
 */
async function findOwnedUniverse(req, res, { lean = false, select = null } = {}) {
  let query = Universe.findById(req.params.id);
  if (select) query = query.select(select);
  if (lean) query = query.lean();

  const uni = await query;

  if (!uni || uni.userId?.toString() !== req.user.id) {
    res.status(404).json({ ok: false, error: "Universe not found" });
    return null;
  }

  return uni;
}

/**
 * Simulation randomness must not replay the same sequence every request
 * (seeding from uni.seed alone did exactly that - every /simulate call
 * rolled identical numbers). Mixing in the universe's current age keeps it
 * deterministic for a given state while advancing the sequence as the
 * universe evolves.
 */
function simulationSeed(uni) {
  return `${uni.seed}:${uni.currentState?.age ?? 0}`;
}

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
    const uni = await findOwnedUniverse(req, res, { lean: true });
    if (!uni) return;
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
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

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
      const Physics = new PhysicsEngine(uni, { seed: simulationSeed(uni) });
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
    const stepSeed = simulationSeed(uni);
    const engineOptions = {
      timeStepYears: diffOpts.timeStepYears,
      difficultyModifier: diffOpts.difficultyModifier,
      seed: stepSeed
    };

    const anomalyOptions = {
      anomalyProbabilityScale: diffOpts.anomalyProbabilityScale,
      maxAnomalyPerStep: diffOpts.maxAnomalyPerStep,
      difficultyModifier: diffOpts.difficultyModifier,
      seed: stepSeed,
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

          recordEvent(uni, {
            type: anomaly.type,
            description: anomaly.description,
            effects: anomaly.effectsRaw
          });
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
        recordEvent(uni, {
          type: "universe_end",
          description: uni.endReason
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
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

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

    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    if (uni.status === "ended") {
      return res.status(400).json({
        ok: false,
        error: "Cannot resolve anomalies in ended universe"
      });
    }

    // Create anomaly generator to resolve
    const AnomalyGen = new AnomalyGenerator(uni, { seed: uni.seed });

    // Resolve anomaly - accuracy (0-100, from the minigame's performance grade)
    // scales the reward; resolveAnomaly() clamps/validates it internally.
    // The Containment Rig upgrade adds a server-side reward bonus computed
    // from the universe's persisted upgrade level, never from client input.
    const containmentMultiplier = 1 + (uni.upgrades?.containment || 0) * CONTAINMENT_BONUS_PER_LEVEL;
    const result = AnomalyGen.resolveAnomaly(anomalyId, accuracy, containmentMultiplier);

    if (!result.success) {
      return res.status(400).json({
        ok: false,
        error: result.reason
      });
    }


    // Record event
    const precisionNote = result.accuracy !== null ? ` at ${result.accuracy.toFixed(0)}% precision` : "";
    recordEvent(uni, {
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
      }
    });

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

// Record scan discoveries. Duplicates/rejections are NOT errors (200):
// clients retry after lost acks and the server must stay idempotent.
// Research value is computed server-side (utils/researchValues.js) - the
// client only reports WHAT was scanned, never what it is worth.
const MAX_DISCOVERIES_PER_BATCH = 20;
const MAX_DISCOVERIES_STORED = 1000;

router.post("/:id/discoveries", async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    const raw = Array.isArray(req.body.discoveries)
      ? req.body.discoveries.slice(0, MAX_DISCOVERIES_PER_BATCH)
      : [];

    const { accepted, duplicates, rejected } = prepareDiscoveries(uni, raw);

    if (accepted.length > 0) {
      uni.discoveries.push(...accepted);
      // Evict oldest past the cap; counters below survive eviction.
      if (uni.discoveries.length > MAX_DISCOVERIES_STORED) {
        uni.discoveries.splice(0, uni.discoveries.length - MAX_DISCOVERIES_STORED);
      }

      const earned = accepted.reduce((sum, d) => sum + d.researchValue, 0);
      if (!uni.research) uni.research = {};
      uni.research.points = (uni.research.points || 0) + earned;
      uni.research.totalEarned = (uni.research.totalEarned || 0) + earned;
      uni.research.discoveryCount = (uni.research.discoveryCount || 0) + accepted.length;
      for (const d of accepted) {
        if (!uni.research.classesDiscovered.includes(d.objectClass)) {
          uni.research.classesDiscovered.push(d.objectClass);
        }
      }

      for (const d of accepted.filter((a) => a.rarity === "rare" || a.rarity === "exceptional")) {
        recordEvent(uni, {
          type: "discovery",
          description: `Cataloged ${d.name} (${d.objectClass})`,
          effects: { discoveryId: d.id, rarity: d.rarity, researchValue: d.researchValue }
        });
      }

      uni.markModified("discoveries");
      uni.markModified("research");
      uni.lastModified = new Date();
      await uni.save();

      console.log(`🔭 ${accepted.length} discoveries (+${earned} RP) in ${uni.name}`);
    }

    return res.json({
      ok: true,
      accepted: accepted.map((d) => d.id),
      duplicates,
      rejected,
      research: uni.research
    });
  } catch (err) {
    console.error("Discoveries error:", err);
    return res.status(500).json({ ok: false, error: "Failed to record discoveries" });
  }
});

// Purchase a ship upgrade with research points. Costs and level caps live in
// utils/upgradeCatalog.js (server-authoritative); the client only names the
// track it wants.
router.post("/:id/upgrade", async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Cannot outfit a ship in an ended universe" });
    }

    const check = validatePurchase(uni, req.body.track);
    if (!check.ok) {
      return res.status(400).json({ ok: false, error: check.reason });
    }

    uni.research.points -= check.cost;
    uni.upgrades[req.body.track] = check.nextLevel;

    recordEvent(uni, {
      type: "upgrade",
      description: `Installed ${check.label} Mk ${check.nextLevel}`,
      effects: { track: req.body.track, level: check.nextLevel, cost: check.cost }
    });

    uni.markModified("upgrades");
    uni.markModified("research");
    uni.lastModified = new Date();
    await uni.save();

    console.log(`🔧 ${check.label} Mk ${check.nextLevel} installed (-${check.cost} RP) in ${uni.name}`);

    return res.json({
      ok: true,
      upgrades: uni.upgrades,
      research: uni.research
    });
  } catch (err) {
    console.error("Upgrade error:", err);
    return res.status(500).json({ ok: false, error: "Failed to purchase upgrade" });
  }
});

// Get engine stats without mutating model
router.get("/:id/stats", async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res, { lean: true });
    if (!uni) return;

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
    const uni = await findOwnedUniverse(req, res, { lean: true, select: 'anomalies userId' });
    if (!uni) return;

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
    const uni = await findOwnedUniverse(req, res, { lean: true });
    if (!uni) return;

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
    const uni = await findOwnedUniverse(req, res, { lean: true });
    if (!uni) return;

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

    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

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