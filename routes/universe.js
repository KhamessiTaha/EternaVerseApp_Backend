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
const { applyWarStrike } = require("../utils/warStrike");
const { applyBombardment } = require("../utils/bombardment");
const { shouldStageOpeningSiege, stageOpeningSiege } = require("../utils/openingSiege");
const { syncPantheon } = require("../utils/pantheon");
const { grantHarvest, MATERIAL_IDS } = require("../utils/materials");
const { spend } = require("../utils/recipes");
const { placeArtifact, recordWork } = require("../utils/artifacts");
const { validatePurchase, CONTAINMENT_BONUS_PER_LEVEL } = require("../utils/upgradeCatalog");
const { doctrineModifiers, isValidDoctrine } = require("../utils/doctrineCatalog");
const { difficultyOptions, simulationSeed, advanceUniverse } = require("../utils/simulationRunner");
const { difficultyStability } = require("../utils/stabilityConfig");
const { applyContact, civDesignation } = require("../utils/contactSystem");
const { respondToPetition } = require("../utils/petitionSystem");
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

/**
 * Copy any newly-ascended species from this universe into the player's
 * account-wide pantheon. Returns the entries added (usually none - this runs
 * on every tick), so the caller can announce them.
 *
 * Deliberately non-fatal: a failure here must never cost the player their
 * simulation tick. The next tick re-syncs, because the source of truth is
 * still universe.legacies.
 */
async function syncUserPantheon(userId, universe) {
  try {
    if (!(universe.legacies || []).length) return [];
    const user = await User.findById(userId).select("pantheon");
    if (!user) return [];

    const { pantheon, added } = syncPantheon(universe, user.pantheon || []);
    if (!added.length) return [];

    user.pantheon = pantheon;
    await user.save();
    return added;
  } catch (err) {
    console.error("Pantheon sync failed (non-fatal):", err.message);
    return [];
  }
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

    // Hybrid Genesis (Coherent Cosmos): a new universe begins ~1.2 Gyr after
    // the Big Bang - the galaxy-formation era - rather than an empty dark-ages
    // void. This makes the very first frame coherent with the render (which is
    // now driven by these numbers) and always explorable: proto-galaxies are
    // condensing and the first stars are alight, with counts the physics engine
    // then grows forward from. Metallicity is authentically low this early.
    uni.currentState = {
      age: 1.2e9,
      _scaleFactor: 1.0,
      expansionRate: universeConstants.H0_km_s_Mpc,
      temperature: initialConditions?.initialTemperature ?? 2.725,
      entropy: 0,
      stabilityIndex: 1.0,
      cosmicPhase: "galaxy_formation",
      galaxyCount: 1.0e6,
      starCount: 1.0e10,
      blackHoleCount: 5.0e3,
      metallicity: 0.04,
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

    // The scripted first siege: a star-faring power falls on a young world
    // near the player, once, after they've met their first civilization. The
    // simulation wouldn't produce a Type II for ~200 more steps, so without
    // this a first session never sees fleet combat at all. Only on a LIVE tick -
    // the cron sweep must never stage drama nobody is present for.
    if (shouldStageOpeningSiege(uni)) {
      const siegeEngine = new PhysicsEngine(uni, {
        seed: `${uni.seed}:opening-siege`,
        playerPosition: uni.lastPlayerPosition,
        // Next door, so the Locator's guidance is a short trip
        civSpawnRange: { min: 1, max: 2 },
      });
      // Take only civs this call actually created - promoting a pre-existing
      // one would rewrite a people the player has already met.
      const before = uni.civilizations.length;
      siegeEngine._spawnCivilizations(2, (uni.currentState?.age || 0) / 1e9);
      const staged = stageOpeningSiege(uni, uni.civilizations.slice(before), now);

      if (staged) {
        uni.currentState.civilizationCount = (uni.currentState.civilizationCount || 0) + 2;
        uni.currentState.civilizationsCreated = (uni.currentState.civilizationsCreated || 0) + 2;
        recordEvent(uni, {
          type: "war",
          description: staged.message,
          effects: {
            outcome: "outbreak",
            a: staged.defender.id,
            b: staged.attacker.id,
            scripted: true,
          },
        });
        uni.markModified("civilizations");
        uni.markModified("currentState");
        uni.markModified("activeWars");
      }
    }

    // Live tick = the player is HERE: keep the visit anchors fresh so the
    // away-digest window starts when they actually leave. The cron sweep
    // deliberately never touches these.
    uni.lastVisitedAt = now;
    uni.lastVisitAge = uni.currentState?.age || 0;

    // An ascension is recorded on the universe it happened in, which means it
    // would die with that universe. Copy it up to the account so it outlives
    // the cosmos that produced it (utils/pantheon.js).
    const ascended = await syncUserPantheon(req.user.id, uni);

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
      // Species that joined the account-wide pantheon on this tick - almost
      // always empty, and the biggest thing in the game when it isn't.
      ascended,
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

// Vessel lost: the death penalty (the game's fail state). Losing your ship is
// no longer free - the universe DRIFTS while you recover: a direct stability
// hit plus a forced time-skip that runs real physics (civs age, anomalies may
// spawn, the reservoir drains). Death now means losing ground in the collapse
// you're fighting, and enough deaths in a crisis can tip the universe over.
const DEATH_PENALTY = {
  Beginner:     { stability: 0.04, steps: 1 },
  Intermediate: { stability: 0.06, steps: 2 },
  Advanced:     { stability: 0.09, steps: 3 },
};

router.post("/:id/vessel-lost", async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;
    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Universe already ended" });
    }

    const difficulty = uni.difficulty || "Intermediate";
    const pen = DEATH_PENALTY[difficulty] || DEATH_PENALTY.Intermediate;

    if (!uni.currentState) uni.currentState = {};
    const before = uni.currentState.stabilityIndex ?? 1;
    // Direct hit first, so the forced steps run from the weakened state and can
    // actually push a fragile universe past collapse.
    uni.currentState.stabilityIndex = Math.max(0, before - pen.stability);
    // Erode the recovery reservoir's ceiling too, so it can't instantly heal
    // the wound back (mirrors how sustained damage caps regen).
    if (typeof uni.currentState.stabilityCeiling === "number") {
      uni.currentState.stabilityCeiling = Math.max(0, uni.currentState.stabilityCeiling - pen.stability);
    }

    const ageBefore = uni.currentState.age || 0;
    const now = new Date();
    const result = advanceUniverse(uni, now, { forceSteps: pen.steps });
    const yearsSkipped = (uni.currentState.age || 0) - ageBefore;
    const stabilityDelta = (uni.currentState.stabilityIndex ?? 0) - before;

    uni.metrics = uni.metrics || {};
    uni.metrics.deaths = (uni.metrics.deaths || 0) + 1;
    uni.markModified("metrics");

    recordEvent(uni, {
      type: "milestone",
      description: `Vessel lost. The universe drifted ${(yearsSkipped / 1e6).toFixed(0)} Myr while you recovered — stability ${(stabilityDelta * 100).toFixed(1)}%.`,
      effects: { death: true, stabilityDelta, yearsSkipped },
    });

    await uni.save();

    return res.json({
      ok: true,
      universe: uni,
      penalty: {
        stabilityDelta,
        yearsSkipped,
        deaths: uni.metrics.deaths,
        hasEnded: uni.status === "ended",
        endReason: uni.endReason,
      },
    });
  } catch (err) {
    console.error("Vessel-lost error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Death penalty error" });
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
    // The chosen doctrine (build identity) scales it further - a Warden is
    // rewarded for containment, a Surveyor/Voidrunner is penalized.
    const containmentMultiplier =
      (1 + (uni.upgrades?.containment || 0) * CONTAINMENT_BONUS_PER_LEVEL) *
      doctrineModifiers(uni.doctrine).containment;
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
    uni.markModified('research');
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
      reward: result.reward,
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

      // Survey-streak bonus: the client reports its scan-chain multiplier; the
      // server clamps it to the legitimate ceiling (+60%) so a tampered payload
      // can never do better than a perfect streak would.
      const streakMult = Math.min(1.6, Math.max(1, ...raw.map((r) => Number(r?.surveyMult) || 1)));
      // Classify-before-scan bonus: the client reports whether the player
      // correctly called a galaxy's Hubble class from its rendered shape,
      // clamped the same way to +50%. Verifying it server-side would mean
      // regenerating procedural world objects here, which is a far larger
      // change - so this trusts the report and caps what a lie can buy.
      // Combined ceiling: 1.6 x 1.5 = 2.4.
      const classifyMult = Math.min(1.5, Math.max(1, ...raw.map((r) => Number(r?.classifyMult) || 1)));
      const base = accepted.reduce((sum, d) => sum + d.researchValue, 0);
      const earned = Math.round(base * streakMult * classifyMult);
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

// Answer a civilization's petition (utils/petitionSystem.js). Body:
// { civId, petitionId, optionId }. Server validates the petition is still the
// live one and applies the chosen outcome.
router.post("/:id/respond-petition", async (req, res) => {
  try {
    const { civId, petitionId, optionId } = req.body;
    if (!civId || !petitionId || !optionId) {
      return res.status(400).json({ ok: false, error: "civId, petitionId and optionId required" });
    }

    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;
    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Cannot respond in an ended universe" });
    }

    const result = respondToPetition(uni, civId, petitionId, optionId);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.reason });
    }

    recordEvent(uni, {
      type: "contact",
      description: result.message,
      effects: { civId, petition: result.kind, optionId }
    });

    uni.markModified("civilizations");
    uni.markModified("research");
    uni.markModified("significantEvents");
    uni.markModified("activeWars"); // arm/broker options mutate wars
    uni.markModified("metrics");
    uni.lastModified = new Date();
    await uni.save();

    console.log(`📜 Petition [${result.kind}/${optionId}] answered for ${civDesignation(civId)} in ${uni.name}`);

    const newAchievements = await awardAchievements(User, req.user.id, uni);
    return res.json({ ok: true, kind: result.kind, optionId, message: result.message, newAchievements, universe: uni });
  } catch (err) {
    console.error("Petition response error:", err);
    return res.status(500).json({ ok: false, error: "Petition response failed" });
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
    // RP paid for the design; matter builds the thing (utils/recipes.js).
    // Mk 1 requires none, so early game spends exactly what it always did.
    uni.materials = spend(uni.materials, check.requirement);
    uni.upgrades[req.body.track] = check.nextLevel;

    recordEvent(uni, {
      type: "upgrade",
      description: `Installed ${check.label} Mk ${check.nextLevel}`,
      effects: {
        track: req.body.track, level: check.nextLevel,
        cost: check.cost, materials: check.requirement || null,
      }
    });

    uni.markModified("upgrades");
    uni.markModified("research");
    uni.markModified("materials");
    uni.lastModified = new Date();
    await uni.save();

    console.log(`🔧 ${check.label} Mk ${check.nextLevel} installed (-${check.cost} RP) in ${uni.name}`);

    const newAchievements = await awardAchievements(User, req.user.id, uni);

    return res.json({
      ok: true,
      upgrades: uni.upgrades,
      research: uni.research,
      materials: uni.materials,
      newAchievements
    });
  } catch (err) {
    console.error("Upgrade error:", err);
    return res.status(500).json({ ok: false, error: "Failed to purchase upgrade" });
  }
});

// Commit to (or clear) a doctrine - the build-identity layer. Respec-friendly:
// switching is free, because the identity lives in the tradeoff you're playing
// with, not in punishing lock-in. Server-authoritative so its reward effects
// (containment) can't be spoofed.
router.post("/:id/doctrine", async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;
    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Cannot re-doctrine a ship in an ended universe" });
    }

    let { doctrine } = req.body;
    if (doctrine === "none") doctrine = null;
    if (!isValidDoctrine(doctrine)) {
      return res.status(400).json({ ok: false, error: "Unknown doctrine" });
    }

    uni.doctrine = doctrine;
    recordEvent(uni, {
      type: "upgrade",
      description: doctrine ? `Adopted the ${doctrine} doctrine` : "Reverted to a stock configuration",
      effects: { doctrine },
    });
    uni.lastModified = new Date();
    await uni.save();

    return res.json({ ok: true, doctrine: uni.doctrine });
  } catch (err) {
    console.error("Doctrine error:", err);
    return res.status(500).json({ ok: false, error: "Failed to set doctrine" });
  }
});

// Report destroyed civilization vessels. The client renders the dogfight; the
// server owns every lasting consequence (regard, militarization, war score).
// Kill counts are clamped and the war is verified server-side, so a tampered
// client can shift a war by at most one clamped strike per request.
router.post("/:id/war-strike", async (req, res) => {
  try {
    const { civId, kills, defendingCivId } = req.body;
    if (!civId) return res.status(400).json({ ok: false, error: "civId required" });

    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Universe has ended" });
    }

    const result = applyWarStrike(uni, civId, kills, { defendingCivId });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });

    recordEvent(uni, {
      type: result.brokeSiege ? "war" : "civilization",
      description: result.message,
      effects: result.effects,
    });

    uni.markModified("civilizations");
    uni.markModified("activeWars");
    uni.lastModified = new Date();
    await uni.save();

    return res.json({
      ok: true,
      message: result.message,
      brokeSiege: result.brokeSiege,
      universe: uni,
    });
  } catch (err) {
    console.error("War strike error:", err);
    return res.status(500).json({ ok: false, error: "Failed to record strike" });
  }
});

/**
 * A siege the player failed to break: bombers reached a world and completed
 * `runs` bombardment runs against it. The client batches these; the server
 * decides what they cost, up to and including the end of a species.
 */
router.post("/:id/bombard", async (req, res) => {
  try {
    const { civId, runs, attackerCivId } = req.body;
    if (!civId || !attackerCivId) {
      return res.status(400).json({ ok: false, error: "civId and attackerCivId required" });
    }

    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Universe has ended" });
    }

    const result = applyBombardment(uni, civId, runs, { attackerCivId });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });

    recordEvent(uni, {
      type: result.extinct ? "extinction" : "war",
      description: result.message,
      effects: result.effects,
    });

    uni.markModified("civilizations");
    uni.markModified("activeWars");
    uni.markModified("currentState");
    uni.lastModified = new Date();
    await uni.save();

    return res.json({
      ok: true,
      message: result.message,
      extinct: result.extinct,
      universe: uni,
    });
  } catch (err) {
    console.error("Bombardment error:", err);
    return res.status(500).json({ ok: false, error: "Failed to record bombardment" });
  }
});

/**
 * Harvest matter from a cosmic source.
 *
 * The client reports WHAT it harvested from and how well it did; the server
 * decides what that yields. The era gate is enforced here rather than trusted,
 * because unlike the classify bonus this IS verifiable - the server owns
 * currentState, so it knows whether this universe has forged gold yet.
 */
router.post("/:id/harvest", async (req, res) => {
  try {
    const { source, grade } = req.body;
    if (!source) return res.status(400).json({ ok: false, error: "source required" });

    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Universe has ended" });
    }

    const result = grantHarvest(uni, source, grade);
    if (!result.ok) {
      // An empty source is a legitimate outcome, not an error - the universe
      // simply hasn't made anything of that kind yet. 200 so the client can
      // explain it rather than treat it as a failure.
      return res.json({ ok: false, empty: !!result.empty, reason: result.reason });
    }

    uni.markModified("materials");
    uni.lastModified = new Date();
    await uni.save();

    return res.json({
      ok: true,
      id: result.id,
      amount: result.amount,
      materials: uni.materials,
    });
  } catch (err) {
    console.error("Harvest error:", err);
    return res.status(500).json({ ok: false, error: "Failed to record harvest" });
  }
});

/**
 * Place an artifact - the only thing in this game the player MAKES.
 *
 * Spends matter, puts an object in the world at a position AND a cosmic scale,
 * and copies it to the account so the work outlives the universe. The account
 * copy is deliberately non-fatal: losing it costs an echo later, losing the
 * player's matter would cost them the build.
 */
router.post("/:id/artifact", async (req, res) => {
  try {
    const { kind, x, y, scale, path, note, civId } = req.body;
    if (!kind) return res.status(400).json({ ok: false, error: "kind required" });

    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    if (uni.status === "ended") {
      return res.status(400).json({ ok: false, error: "Nothing can be built in an ended universe" });
    }

    const result = placeArtifact(uni, { kind, x, y, scale, path, note, civId });
    if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });

    recordEvent(uni, {
      type: "artifact",
      description: `Raised a ${result.artifact.label}${result.artifact.note ? ` — "${result.artifact.note}"` : ""}`,
      effects: { kind, x: result.artifact.x, y: result.artifact.y },
    });

    uni.markModified("materials");
    uni.markModified("artifacts");
    uni.lastModified = new Date();
    await uni.save();

    try {
      const user = await User.findById(req.user.id).select("works");
      if (user) {
        const { works, added } = recordWork(user.works, result.artifact, uni);
        if (added) { user.works = works; await user.save(); }
      }
    } catch (err) {
      console.error("Work record failed (non-fatal):", err.message);
    }

    return res.json({
      ok: true,
      artifact: result.artifact,
      materials: uni.materials,
      artifacts: uni.artifacts,
    });
  } catch (err) {
    console.error("Artifact error:", err);
    return res.status(500).json({ ok: false, error: "Failed to raise artifact" });
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
    // Snapshot the reservoir before advancing so the dev console can show the
    // exact stability trajectory a jump produced (the whole point of the tool
    // is watching drain / escalation / crisis build across a fast-forward).
    const stabilityBefore = uni.currentState.stabilityIndex;
    const result = advanceUniverse(uni, new Date(), { forceSteps: steps });
    await uni.save();

    const cs = uni.currentState;
    console.log(`🛠️ [DEV] Fast-forwarded ${uni.name} by ${result.steps} steps`);
    return res.json({
      ok: true,
      steps: result.steps,
      stability: {
        before: stabilityBefore,
        after: cs.stabilityIndex,
        ceiling: cs.stabilityCeiling,
        criticalSteps: cs.criticalSteps || 0,
        crisisWindow: difficultyStability(uni.difficulty || "Intermediate").crisisWindow,
        activeAnomalies: (uni.anomalies || []).filter((a) => !a.resolved).length,
      },
      ended: uni.status === "ended",
      endCondition: uni.endCondition || null,
      stats: result.Physics.getStatistics(),
      universe: uni,
    });
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

/**
 * One-click siege: two Type II powers spawned next door and immediately at
 * war, so the whole fleet-combat loop (raid waves, escorts, bombardment,
 * extinction) is one button away instead of four setup steps.
 */
router.post("/:id/dev/stage-siege", requireAdmin, async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    const engine = new PhysicsEngine(uni, {
      seed: `${uni.seed}:dev:${Date.now()}`,
      playerPosition: uni.lastPlayerPosition,
      civSpawnRange: { min: 1, max: 2 }
    });
    engine._spawnCivilizations(2, (uni.currentState?.age || 0) / 1e9);

    // Only Type II+ can project force at another world, so both sides need
    // the tier (and the technology to justify it) for the siege to happen.
    const [a, b] = uni.civilizations.slice(-2);
    for (const civ of [a, b]) {
      civ.type = "Type2";
      civ.technology = Math.max(civ.technology || 0, 55);
      civ.warlikeness = 0.7;
    }
    uni.currentState.civilizationCount = (uni.currentState.civilizationCount || 0) + 2;
    uni.currentState.civilizationsCreated = (uni.currentState.civilizationsCreated || 0) + 2;

    if (!Array.isArray(uni.activeWars)) uni.activeWars = [];
    uni.activeWars.push({
      id: `war_${Date.now()}_dev`,
      a: a.id, b: b.id, scoreA: 0, scoreB: 0, startedAt: new Date()
    });
    recordEvent(uni, {
      type: "war",
      description: `War erupts between ${civDesignation(a.id)} and ${civDesignation(b.id)}. A strike force is already under way.`,
      effects: { outcome: "outbreak", a: a.id, b: b.id }
    });

    uni.markModified("civilizations");
    uni.markModified("currentState");
    uni.markModified("activeWars");
    uni.markModified("significantEvents");
    await uni.save();

    console.log(`🛠️ [DEV] Siege staged in ${uni.name}`);
    return res.json({ ok: true, universe: uni });
  } catch (err) {
    console.error("Dev stage-siege error:", err);
    return res.status(500).json({ ok: false, error: "Failed to stage siege" });
  }
});

/**
 * Re-arm the scripted first siege so it can be tested more than once: clears
 * the one-shot stamp and removes the scripted war (and the two civs it was
 * staged with), leaving a natural universe behind. The next live tick with an
 * observed civ and no Type II will stage a fresh one.
 */
router.post("/:id/dev/reset-opening-siege", requireAdmin, async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    const scripted = (uni.activeWars || []).filter((w) => w.scripted);
    const stagedIds = new Set(scripted.flatMap((w) => [w.a, w.b]));

    uni.activeWars = (uni.activeWars || []).filter((w) => !w.scripted);
    uni.civilizations = (uni.civilizations || []).filter((c) => !stagedIds.has(c.id));
    uni.currentState.civilizationCount = Math.max(
      0, (uni.currentState.civilizationCount || 0) - stagedIds.size
    );
    uni.scriptedSiegeAt = null;

    uni.markModified("civilizations");
    uni.markModified("currentState");
    uni.markModified("activeWars");
    await uni.save();

    console.log(`🛠️ [DEV] Opening siege re-armed for ${uni.name}`);
    return res.json({ ok: true, removed: stagedIds.size, universe: uni });
  } catch (err) {
    console.error("Dev reset-opening-siege error:", err);
    return res.status(500).json({ ok: false, error: "Failed to reset opening siege" });
  }
});

/**
 * Jump this universe's ENRICHMENT so the material era-gates can be tested.
 *
 * metallicity and stellarGenerations climb over hundreds of simulation steps,
 * which means a fresh universe can never show you gold, uranium or a kilonova
 * - the gates in utils/materials.js are simply unreachable by playing for a
 * few minutes. This sets them directly.
 *
 * Deliberately does NOT touch age, stability or anomalies: this is a materials
 * testing tool, not a time machine, and conflating the two would make it
 * useless for isolating what it's meant to isolate.
 */
router.post("/:id/dev/set-era", requireAdmin, async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v)));
    const cs = uni.currentState;

    if (req.body.metallicity !== undefined) cs.metallicity = clamp(req.body.metallicity, 0, 1);
    if (req.body.stellarGenerations !== undefined) cs.stellarGenerations = clamp(req.body.stellarGenerations, 0, 10);
    if (req.body.blackHoleCount !== undefined) cs.blackHoleCount = Math.max(0, Number(req.body.blackHoleCount));

    uni.markModified("currentState");
    await uni.save();

    console.log(`🛠️ [DEV] Era set in ${uni.name}: Z=${cs.metallicity} gen=${cs.stellarGenerations} BH=${cs.blackHoleCount}`);
    return res.json({ ok: true, universe: uni });
  } catch (err) {
    console.error("Dev set-era error:", err);
    return res.status(500).json({ ok: false, error: "Failed to set era" });
  }
});

/** Fill the hold, so Mk 2/Mk 3 crafting can be tested without a harvest grind. */
router.post("/:id/dev/grant-materials", requireAdmin, async (req, res) => {
  try {
    const uni = await findOwnedUniverse(req, res);
    if (!uni) return;

    const amount = Math.max(1, Math.min(999, Math.floor(Number(req.body.amount) || 20)));
    const stock = { ...(uni.materials || {}) };
    for (const id of MATERIAL_IDS) stock[id] = (Number(stock[id]) || 0) + amount;
    uni.materials = stock;

    uni.markModified("materials");
    await uni.save();

    console.log(`🛠️ [DEV] Granted ${amount} of every material in ${uni.name}`);
    return res.json({ ok: true, materials: uni.materials, universe: uni });
  } catch (err) {
    console.error("Dev grant-materials error:", err);
    return res.status(500).json({ ok: false, error: "Failed to grant materials" });
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

    // Optional overrides so tier and attitude features are testable without
    // grinding. `civType` sets the Kardashev tier, which gates BOTH where a
    // people is met (civPlacement) and what it can field: a Type 0 has no
    // vessels at all, Type I keeps light craft, Type II+ a real fleet.
    // Technology is raised to match, so a forced tier isn't a Type III that
    // hasn't discovered fire.
    const disposition = req.body.disposition;
    const civType = req.body.civType;
    const TIER_TECH = { Type1: 25, Type2: 55, Type3: 85 };

    if (disposition || civType) {
      for (const civ of uni.civilizations.slice(-count)) {
        // Type 0 civs never fire and field no fleet, so any attitude test
        // needs at least Type I.
        const type = TIER_TECH[civType] ? civType : (disposition ? "Type1" : civ.type);
        if (TIER_TECH[type]) {
          civ.type = type;
          civ.technology = Math.max(civ.technology || 0, TIER_TECH[type]);
        }
        if (disposition === "worship") {
          civ.relationship = 0.6;
          civ.warlikeness = Math.min(civ.warlikeness ?? 0.5, 0.4);
        } else if (disposition === "hostile") {
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