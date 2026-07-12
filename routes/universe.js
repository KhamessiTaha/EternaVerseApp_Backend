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
const { difficultyOptions, simulationSeed, advanceUniverse } = require("../utils/simulationRunner");
const { applyContact, civDesignation } = require("../utils/contactSystem");
const requireAdmin = require("../middleware/adminMiddleware");
const { ensureMissions, claimMission } = require("../utils/missionSystem");
const { awardAchievements } = require("../utils/achievements");
const { applyMinorResolution } = require("../utils/minorAnomalies");
const { claimEventReward } = require("../utils/eventRewards");
const User = require("../models/User");

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

    // Every universe starts with a full objective board
    ensureMissions(uni);

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

    // "While you were away": hand back the PREVIOUS visit anchors for the
    // client's digest, then stamp this visit. Fire-and-forget - the stamp
    // must never delay or fail the load.
    const previousVisit = {
      at: uni.lastVisitedAt || null,
      age: uni.lastVisitAge ?? null,
    };
    Universe.updateOne(
      { _id: uni._id },
      { lastVisitedAt: new Date(), lastVisitAge: uni.currentState?.age || 0 }
    ).catch((err) => console.error("Visit stamp failed:", err.message));

    return res.json({ ok: true, universe: uni, previousVisit });
  } catch (err) {
    console.error("Get universe error:", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// Advance the universe by however much wall-clock time has elapsed. The
// pipeline itself lives in utils/simulationRunner.js, shared with the cron
// sweep so offline and online simulation are bit-identical.
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

    // Player position drives where anomalies spawn - persist whatever the
    // client last reported, and fall back to that if this call doesn't send
    // one (e.g. the cron sweep, or a tick without a fresh position).
    const incomingPosition = req.body.playerPosition;
    if (
      incomingPosition &&
      typeof incomingPosition.x === "number" &&
      typeof incomingPosition.y === "number"
    ) {
      uni.lastPlayerPosition = { x: incomingPosition.x, y: incomingPosition.y };
    }

    const now = new Date();
    const result = advanceUniverse(uni, now);

    if (result.steps === 0) {
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

    // Top up the objective board (covers universes created before missions
    // existed, and templates that only became eligible as the sim evolved)
    if (ensureMissions(uni) > 0) {
      uni.markModified("missions");
    }

    // Live tick = the player is HERE: keep the visit anchors fresh so the
    // away-digest window starts when they actually leave. The cron sweep
    // deliberately never touches these.
    uni.lastVisitedAt = now;
    uni.lastVisitAge = uni.currentState?.age || 0;

    // ML predictions (after simulation)
    const predictions = new MLPredictor(uni).generatePredictions();

    // Save with error handling
    try {
      await uni.save();
    } catch (saveErr) {
      // Concurrent-writer conflict: the cron sweep (or another request)
      // advanced this universe between our load and save, so Mongoose's
      // version check rejects our stale write ("No matching document found
      // for id..."). The universe DID advance - just not by this request -
      // so hand back the fresh state instead of a 500. Our own steps are
      // safely re-derivable: lastSimulatedAt now reflects the other
      // writer's save, and the next tick catches up whatever remains.
      const isVersionConflict =
        saveErr.name === "VersionError" || /No matching document found/i.test(saveErr.message);
      if (isVersionConflict) {
        const fresh = await Universe.findById(uni._id).lean();
        if (fresh && fresh.userId?.toString() === req.user.id) {
          console.log(`↩️ Simulate save superseded by concurrent writer for ${fresh.name} - returning fresh state`);
          const Physics = new PhysicsEngine(fresh, { seed: simulationSeed(fresh) });
          return res.json({
            ok: true,
            steps: 0,
            skipped: true,
            concurrent: true,
            stats: Physics.getStatistics(),
            createdAnomalies: [],
            hasEnded: fresh.status === "ended",
            endCondition: fresh.endCondition,
            endReason: fresh.endReason,
            universe: fresh
          });
        }
      }

      console.error("Save error:", saveErr);
      return res.status(500).json({
        ok: false,
        error: "Failed to save simulation state",
        details: saveErr.message
      });
    }

    const stats = result.Physics.getStatistics();
    const anomalyStats = result.AnomalyGen.getAnomalyStats();
    const endStatus = result.EndChecker.getEndConditionStatus();
    const warnings = result.EndChecker.getWarnings();

    console.log(
      `🎮 Simulated ${result.steps} steps | ` +
      `Age: ${stats.ageGyr} Gyr | ` +
      `Stability: ${stats.stability} | ` +
      `Anomalies: ${anomalyStats.active}/${anomalyStats.total}`
    );

    if (uni.status === "ended") {
      console.log(`🌑 Universe ended: ${uni.endCondition} - ${uni.endReason}`);
    }

    const newAchievements = await awardAchievements(User, req.user.id, uni);

    return res.json({
      ok: true,
      steps: result.steps,
      stats,
      anomalyStats,
      endStatus,
      warnings,
      predictions,
      createdAnomalies: result.createdAnomalies,
      hasEnded: uni.status === "ended",
      endCondition: uni.endCondition,
      endReason: uni.endReason,
      newAchievements,
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

    const newAchievements = accepted.length > 0 ? await awardAchievements(User, req.user.id, uni) : [];

    return res.json({
      ok: true,
      accepted: accepted.map((d) => d.id),
      duplicates,
      rejected,
      research: uni.research,
      newAchievements
    });
  } catch (err) {
    console.error("Discoveries error:", err);
    return res.status(500).json({ ok: false, error: "Failed to record discoveries" });
  }
});

// Resolve a MINOR (chunk-seeded) anomaly. The client names the anomaly by
// its deterministic id; the server validates the id shape, dedups against
// persistent history, and computes the (modest) real rewards - including
// metrics.anomaliesResolved, so minors count toward containment missions.
router.post("/:id/resolve-minor", async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Universe already ended" });
    }

    const result = applyMinorResolution(uni, {
      anomalyId: req.body.anomalyId,
      severity: req.body.severity,
      accuracy: req.body.accuracy
    }, CONTAINMENT_BONUS_PER_LEVEL);

    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.reason, duplicate: !!result.duplicate });
    }

    uni.markModified("currentState");
    uni.markModified("research");
    uni.markModified("metrics");
    uni.markModified("resolvedMinorAnomalies");
    uni.lastModified = new Date();
    await uni.save();

    const newAchievements = await awardAchievements(User, req.user.id, uni);

    return res.json({
      ok: true,
      reward: result.reward,
      stabilityBoost: result.stabilityBoost,
      newAchievements,
      universe: uni
    });
  } catch (err) {
    console.error("Resolve minor anomaly error:", err);
    return res.status(500).json({ ok: false, error: "Resolution failed" });
  }
});

// Claim a live cosmic event reward (supernova capture / comet sample /
// derelict salvage). Rate-limited per event kind server-side - see
// utils/eventRewards.js for why this is cooldown-trust rather than proof.
router.post("/:id/event-reward", async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Universe already ended" });
    }

    const result = claimEventReward(uni, req.body.kind);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.reason, cooldown: !!result.cooldown });
    }

    recordEvent(uni, {
      type: "cosmic_event",
      description: result.title,
      effects: { kind: req.body.kind, reward: result.reward }
    });

    uni.markModified("research");
    uni.markModified("eventRewards");
    uni.markModified("significantEvents");
    uni.lastModified = new Date();
    await uni.save();

    return res.json({ ok: true, reward: result.reward, title: result.title, universe: uni });
  } catch (err) {
    console.error("Event reward error:", err);
    return res.status(500).json({ ok: false, error: "Claim failed" });
  }
});

// Claim a completed mission. Completion is validated server-side against
// live universe state; the reward flows through the research economy and a
// replacement objective is issued automatically.
router.post("/:id/claim-mission", async (req, res) => {
  try {
    const { missionId } = req.body;
    if (!missionId) {
      return res.status(400).json({ ok: false, error: "missionId required" });
    }

    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Cannot claim missions in an ended universe" });
    }

    const result = claimMission(uni, missionId);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.reason });
    }

    recordEvent(uni, {
      type: "mission",
      description: `Objective complete: ${result.mission.title} (+${result.reward} RP)`,
      effects: { missionId, templateId: result.mission.templateId, reward: result.reward }
    });

    uni.markModified("missions");
    uni.markModified("research");
    uni.markModified("significantEvents");
    uni.lastModified = new Date();
    await uni.save();

    console.log(`🎯 Mission claimed in ${uni.name}: ${result.mission.title} (+${result.reward} RP)`);

    const newAchievements = await awardAchievements(User, req.user.id, uni);

    return res.json({ ok: true, reward: result.reward, title: result.mission.title, newAchievements, universe: uni });
  } catch (err) {
    console.error("Claim mission error:", err);
    return res.status(500).json({ ok: false, error: "Claim failed" });
  }
});

// First Contact: interact with a civilization (observe / uplift / pacify).
// All effects, costs, and the uplift backfire roll are server-side
// (utils/contactSystem.js) - the client only names the civ and the action.
router.post("/:id/contact-civilization", async (req, res) => {
  try {
    const { civId, action } = req.body;
    if (!civId || !action) {
      return res.status(400).json({ ok: false, error: "civId and action required" });
    }

    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Cannot contact civilizations in an ended universe" });
    }

    const result = applyContact(uni, civId, action);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.reason });
    }

    recordEvent(uni, {
      type: "contact",
      description: result.message,
      effects: { civId, action, outcome: result.outcome, cost: result.cost ?? 0, reward: result.reward ?? 0 }
    });

    uni.markModified("civilizations");
    uni.markModified("research");
    uni.markModified("significantEvents");
    uni.markModified("activeWars"); // arm mutates scores; broker removes entries
    uni.markModified("metrics");    // broker increments warsBrokered
    uni.lastModified = new Date();
    await uni.save();

    console.log(`🛸 Contact [${action}/${result.outcome}] with ${civDesignation(civId)} in ${uni.name}`);

    const newAchievements = await awardAchievements(User, req.user.id, uni);

    return res.json({
      ok: true,
      outcome: result.outcome,
      message: result.message,
      cost: result.cost ?? 0,
      reward: result.reward ?? 0,
      newAchievements,
      universe: uni
    });
  } catch (err) {
    console.error("Contact error:", err);
    return res.status(500).json({ ok: false, error: "Contact failed" });
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

    const newAchievements = await awardAchievements(User, req.user.id, uni);

    return res.json({
      ok: true,
      upgrades: uni.upgrades,
      research: uni.research,
      newAchievements
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

// ============================================================
// DEV / TEST ENDPOINTS (admin only)
//
// Every route below runs requireAdmin, which re-checks isAdmin against the
// DB per request - the flag itself is only settable by editing the user
// document in MongoDB directly, so regular players cannot reach these even
// by calling the API by hand. All input amounts are clamped server-side.
// ============================================================

// Fast-forward the simulation by N steps regardless of wall-clock time
router.post("/:id/dev/fast-forward", requireAdmin, async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;
    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Universe already ended" });
    }

    const steps = Math.max(1, Math.min(500, Math.floor(Number(req.body.steps) || 1)));
    const result = advanceUniverse(uni, new Date(), { forceSteps: steps });
    await uni.save();

    console.log(`🛠️ [DEV] Fast-forwarded ${uni.name} by ${result.steps} steps`);
    return res.json({ ok: true, steps: result.steps, stats: result.Physics.getStatistics(), universe: uni });
  } catch (err) {
    console.error("Dev fast-forward error:", err);
    return res.status(500).json({ ok: false, error: "Fast-forward failed" });
  }
});

// Grant research points
router.post("/:id/dev/grant-research", requireAdmin, async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    const points = Math.max(1, Math.min(100000, Math.floor(Number(req.body.points) || 0)));
    if (!uni.research) uni.research = {};
    uni.research.points = (uni.research.points || 0) + points;
    uni.markModified("research");
    await uni.save();

    console.log(`🛠️ [DEV] Granted ${points} RP in ${uni.name}`);
    return res.json({ ok: true, granted: points, universe: uni });
  } catch (err) {
    console.error("Dev grant-research error:", err);
    return res.status(500).json({ ok: false, error: "Grant failed" });
  }
});

// Force-spawn anomalies near the player (no probability gates, no effects
// applied to universe state - just interactable test targets)
router.post("/:id/dev/spawn-anomalies", requireAdmin, async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    const count = Math.max(1, Math.min(10, Math.floor(Number(req.body.count) || 1)));
    const AnomalyGen = new AnomalyGenerator(uni, {
      seed: `${uni.seed}:dev:${Date.now()}`,
      playerPosition: uni.lastPlayerPosition,
      anomalyIdFactory: () => `${uni._id.toString()}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    });
    const created = AnomalyGen.forceSpawn(count);

    uni.markModified("anomalies");
    await uni.save();

    console.log(`🛠️ [DEV] Spawned ${created.length} anomalies in ${uni.name}`);
    return res.json({ ok: true, created, universe: uni });
  } catch (err) {
    console.error("Dev spawn-anomalies error:", err);
    return res.status(500).json({ ok: false, error: "Spawn failed" });
  }
});

// Force-start a war between the two most recently spawned living civs
router.post("/:id/dev/start-war", requireAdmin, async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    const alive = (uni.civilizations || []).filter((c) => !c.extinct);
    if (alive.length < 2) {
      return res.status(400).json({ ok: false, error: "Need 2+ living civilizations (spawn some first)" });
    }

    const [a, b] = alive.slice(-2);
    if (!Array.isArray(uni.activeWars)) uni.activeWars = [];
    uni.activeWars.push({
      id: `war_${Date.now()}_dev`,
      a: a.id, b: b.id, scoreA: 0, scoreB: 0, startedAt: new Date()
    });
    recordEvent(uni, {
      type: "war",
      description: `War erupts between ${civDesignation(a.id)} and ${civDesignation(b.id)}. Both fleets are burning fuel toward the frontier.`,
      effects: { outcome: "outbreak", a: a.id, b: b.id }
    });

    uni.markModified("activeWars");
    uni.markModified("significantEvents");
    await uni.save();

    console.log(`🛠️ [DEV] War started in ${uni.name}`);
    return res.json({ ok: true, universe: uni });
  } catch (err) {
    console.error("Dev start-war error:", err);
    return res.status(500).json({ ok: false, error: "War failed to start (ironic)" });
  }
});

// Rewind the visit anchors so the NEXT entry into this universe shows the
// "while you were away" digest (pair with fast-forward to generate events
// inside the window)
router.post("/:id/dev/rewind-visit", requireAdmin, async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    uni.lastVisitedAt = new Date(Date.now() - 2 * 3600 * 1000); // "2 hours ago"
    uni.lastVisitAge = Math.max(0, (uni.currentState?.age || 0) - 0.5e9);
    await uni.save();

    console.log(`🛠️ [DEV] Visit anchors rewound for ${uni.name}`);
    return res.json({ ok: true, universe: uni });
  } catch (err) {
    console.error("Dev rewind-visit error:", err);
    return res.status(500).json({ ok: false, error: "Rewind failed" });
  }
});

// Force-spawn civilizations near the player
router.post("/:id/dev/spawn-civilizations", requireAdmin, async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    const count = Math.max(1, Math.min(10, Math.floor(Number(req.body.count) || 1)));
    const engine = new PhysicsEngine(uni, {
      seed: `${uni.seed}:dev:${Date.now()}`,
      playerPosition: uni.lastPlayerPosition,
      // Test civs land practically next door so they're findable immediately
      civSpawnRange: { min: 1, max: 2 }
    });
    // Reuses the sim's own spawner so dev civs have the exact same shape as
    // natural ones; the caller owns the counters, mirroring _manageCivilizations
    engine._spawnCivilizations(count, (uni.currentState?.age || 0) / 1e9);

    // Optional disposition override so attitude features (worship tribute,
    // hostile missile fire) are testable without grinding relationship
    const disposition = req.body.disposition;
    if (disposition === "worship" || disposition === "hostile") {
      for (const civ of uni.civilizations.slice(-count)) {
        if (disposition === "worship") {
          civ.type = "Type1";
          civ.relationship = 0.6;
          civ.warlikeness = Math.min(civ.warlikeness ?? 0.5, 0.4);
        } else {
          civ.type = "Type1"; // Type0 civs never fire - see CivilizationSystem
          civ.relationship = -0.6;
          civ.warlikeness = 0.85;
        }
      }
    }
    uni.currentState.civilizationCount = (uni.currentState.civilizationCount || 0) + count;
    uni.currentState.civilizationsCreated = (uni.currentState.civilizationsCreated || 0) + count;

    uni.markModified("civilizations");
    uni.markModified("currentState");
    await uni.save();

    console.log(`🛠️ [DEV] Spawned ${count} civilizations in ${uni.name}`);
    return res.json({ ok: true, spawned: count, universe: uni });
  } catch (err) {
    console.error("Dev spawn-civilizations error:", err);
    return res.status(500).json({ ok: false, error: "Spawn failed" });
  }
});

module.exports = router;