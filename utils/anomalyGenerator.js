const seedrandom = require("seedrandom");
const { recordEvent } = require("./eventLog");
const STAB = require("./stabilityConfig");

const CHUNK_SIZE = 1000;
const MAX_ANOMALIES_PER_UNIVERSE = 200; // Hard limit to prevent DB bloat

// Mirrors the frontend's GRADE_TIERS (src/components/game/utils.js) so a
// minigame grade means the same reward whether it's shown to the player or
// applied server-side. If these ever diverge, that's a balance bug to fix,
// not an API contract to enforce - the two codebases don't share a package.
const PERFORMANCE_TIERS = [
  { min: 95, multiplier: 1.3 },  // S
  { min: 85, multiplier: 1.15 }, // A
  { min: 70, multiplier: 1.0 },  // B
  { min: 50, multiplier: 0.85 }, // C
  { min: 0, multiplier: 0.5 },   // technically resolved, but sloppy - still some credit
];

function getPerformanceMultiplier(accuracy) {
  // No accuracy reported (e.g. an older client) - don't penalize, full reward
  if (typeof accuracy !== "number" || Number.isNaN(accuracy)) return 1.0;
  const clamped = Math.max(0, Math.min(100, accuracy));
  const tier = PERFORMANCE_TIERS.find((t) => clamped >= t.min) || PERFORMANCE_TIERS[PERFORMANCE_TIERS.length - 1];
  return tier.multiplier;
}

class AnomalyGenerator {
  constructor(universe, options = {}) {
    if (!universe) throw new Error("AnomalyGenerator requires a universe object");

    this.universe = universe;
    this.options = {
      anomalyProbabilityScale: options.anomalyProbabilityScale ?? 0.01,
      maxAnomalyPerStep: options.maxAnomalyPerStep ?? 5,
      seed: options.seed ?? universe?.seed ?? "default-seed",
      anomalyIdFactory: options.anomalyIdFactory ?? (() => `${universe._id.toString()}_${Date.now()}_${Math.floor(Math.random()*1e6)}`),
      difficultyModifier: options.difficultyModifier ?? 1.0,
      playerPosition: options.playerPosition ?? { x: 0, y: 0 },
      ...options,
    };

    this.rng = seedrandom(this.options.seed + "_anomaly");
    
    const uniConstants = universe.constants || {};
    this.constants = {
      observableGalaxies: uniConstants.observableGalaxies ?? 2e11,
    };
  }

  _rand() {
    return this.rng();
  }

  _clamp(v, min = -Infinity, max = Infinity) {
    return Math.max(min, Math.min(max, v));
  }

  _getChunkCoords(x, y) {
    return {
      chunkX: Math.floor(x / CHUNK_SIZE),
      chunkY: Math.floor(y / CHUNK_SIZE),
    };
  }

  getAnomalyTypes() {
    return [
      {
        id: "blackHoleMerger",
        probability: 0.001,
        condition: (cs) => cs.blackHoleCount > 1e5,
        effects: severity => ({ 
          stabilityImpact: -0.008 * severity,
          gravitationalWaveEnergy: 1e50 * severity,
          entropy: 5e6 * severity
        }),
        description: "Massive black hole merger detected",
        category: "gravitational"
      },
      {
        id: "darkEnergySurge",
        probability: 0.0004,
        condition: (cs, ageGyr) => ageGyr > 5,
        effects: severity => ({
          expansionBoost: 0.0008 * severity,
          stabilityImpact: -0.012 * severity,
          scaleFactorBump: 0.001 * severity
        }),
        description: "Dark energy fluctuation",
        category: "cosmological"
      },
      {
        id: "supernovaChain",
        probability: 0.0015,
        condition: (cs) => cs.starCount > 1e9,
        effects: severity => ({
          metallicityIncrease: 0.0005 * severity,
          starDeathCount: 100 * severity,
          stabilityImpact: -0.005 * severity,
          energyRelease: 1e51 * severity
        }),
        description: "Supernova cascade event",
        category: "stellar"
      },
      {
        id: "quantumFluctuation",
        probability: 0.0003,
        condition: () => true, // Always possible
        effects: severity => ({
          localEntropyDecrease: -1e6 * severity,
          stabilityImpact: -0.015 * severity,
          quantumCoherence: -0.01 * severity
        }),
        description: "Quantum vacuum instability",
        category: "quantum"
      },
      {
        id: "galacticCollision",
        probability: 0.0008,
        condition: (cs, ageGyr) => cs.galaxyCount > 1e6 && ageGyr > 2,
        effects: severity => ({
          starFormationBurst: 5000 * severity,
          stabilityImpact: -0.007 * severity,
          blackHoleFormation: 10 * severity
        }),
        description: "Major galactic collision",
        category: "structural"
      },
      {
        id: "cosmicVoid",
        probability: 0.0003,
        condition: (cs, ageGyr) => ageGyr > 3,
        effects: severity => ({
          galaxyLoss: 1000 * severity,
          stabilityImpact: -0.01 * severity,
          localExpansion: 0.001 * severity
        }),
        description: "Expanding cosmic void",
        category: "structural"
      },
      {
        id: "magneticReversal",
        probability: 0.0005,
        condition: (cs) => cs.galaxyCount > 1e5,
        effects: severity => ({
          stellarWindDisruption: 0.005 * severity,
          stabilityImpact: -0.004 * severity,
          habitabilityReduction: -100 * severity
        }),
        description: "Galactic magnetic field reversal",
        category: "electromagnetic"
      },
      {
        id: "darkMatterClump",
        probability: 0.0006,
        condition: (cs, ageGyr) => ageGyr > 1,
        effects: severity => ({
          gravitationalAnomaly: 0.01 * severity,
          stabilityImpact: -0.006 * severity,
          structureDistortion: 0.005 * severity
        }),
        description: "Dark matter density spike",
        category: "gravitational"
      }
    ];
  }

  autoCleanup() {
    const currentTotal = this.universe.anomalies.length;
    
    if (currentTotal >= MAX_ANOMALIES_PER_UNIVERSE) {
      console.log(`🧹 Auto-cleanup: ${currentTotal} anomalies (limit: ${MAX_ANOMALIES_PER_UNIVERSE})`);
      
      const cutoffTime = Date.now() - 5 * 60 * 1000;
      const before = this.universe.anomalies.length;
      
      this.universe.anomalies = this.universe.anomalies.filter(a => {
        if (!a.resolved) return true;
        const resolvedTime = new Date(a.resolvedAt || a.timestamp).getTime();
        return resolvedTime > cutoffTime;
      });
      
      const removed = before - this.universe.anomalies.length;
      console.log(`   Removed ${removed} old anomalies, ${this.universe.anomalies.length} remaining`);
      
      return removed;
    }
    
    return 0;
  }

  generateAnomalies() {
    const cs = this.universe.currentState;
    const ageGyr = cs.age / 1e9;
    
    this.autoCleanup();
    
    if (this.universe.anomalies.length >= MAX_ANOMALIES_PER_UNIVERSE) {
      console.log(`⚠️ Anomaly limit reached (${MAX_ANOMALIES_PER_UNIVERSE}), skipping generation`);
      return [];
    }
    
    const activity = Math.min(1, cs.galaxyCount / Math.max(1, this.constants.observableGalaxies));
    const baseProb = this.options.anomalyProbabilityScale * activity;

    const anomalyTypes = this.getAnomalyTypes();
    const created = [];
    const cap = Math.max(1, Math.floor(this.options.maxAnomalyPerStep));

    for (const def of anomalyTypes) {
      if (!def.condition(cs, ageGyr)) continue;

      // Balanced probability: aims for 1-5% chance per eligible type per step
      const prob = def.probability * baseProb * 10000;
      const roll = this._rand();

      if (roll < prob) {
        const severity = 1 + Math.floor(this._rand() * 3);
        created.push(this._buildAnomaly(def, severity));

        if (created.length >= cap) break;
      }
    }

    if (created.length > 0) {
      const playerChunk = this._getChunkCoords(this.options.playerPosition.x, this.options.playerPosition.y);
      const summary = created.map(a => `${a.type} sev${a.severity}`).join(', ');
      console.log(`✨ Generated ${created.length} anomalies near player chunk (${playerChunk.chunkX}, ${playerChunk.chunkY}): ${summary}`);
    }

    return created;
  }

  /** Build one anomaly of the given type near the player (1-4 chunks out). */
  _buildAnomaly(def, severity) {
    const playerPos = this.options.playerPosition || { x: 0, y: 0 };
    const playerChunk = this._getChunkCoords(playerPos.x, playerPos.y);

    const angle = this._rand() * Math.PI * 2;
    const distance = 1 + this._rand() * 3; // 1-4 chunks

    const targetChunkX = playerChunk.chunkX + Math.floor(Math.cos(angle) * distance);
    const targetChunkY = playerChunk.chunkY + Math.floor(Math.sin(angle) * distance);

    return {
      id: this.options.anomalyIdFactory(),
      type: def.id,
      category: def.category,
      severity,
      timestamp: new Date(),
      resolved: false,
      effectsRaw: def.effects(severity),
      location: {
        x: targetChunkX * CHUNK_SIZE + this._rand() * CHUNK_SIZE,
        y: targetChunkY * CHUNK_SIZE + this._rand() * CHUNK_SIZE,
        z: (this._rand() - 0.5) * 1e4
      },
      radius: 1000 * severity,
      description: def.description,
      decayRate: 0.001 * this._rand(),
    };
  }

  /**
   * Dev tooling: unconditionally create `count` anomalies near the player,
   * skipping the probability rolls and population conditions that gate
   * natural spawns. Pushes onto the universe and returns them; effects are
   * NOT applied to universe state (test spawns shouldn't damage stability).
   */
  forceSpawn(count = 1) {
    const defs = this.getAnomalyTypes();
    const created = [];
    for (let i = 0; i < count; i++) {
      const def = defs[Math.floor(this._rand() * defs.length)];
      const severity = 1 + Math.floor(this._rand() * 3);
      created.push(this._buildAnomaly(def, severity));
    }
    this.universe.anomalies.push(...created);
    return created;
  }

  applyAnomalyEffects(effects = {}) {
    const cs = this.universe.currentState;
    if (!effects) return;

    if (typeof effects.stabilityImpact === "number") {
      cs.stabilityIndex = this._clamp(cs.stabilityIndex + effects.stabilityImpact, 0, 1);
    }
    if (typeof effects.expansionBoost === "number") {
      cs.expansionRate = cs.expansionRate * (1 + effects.expansionBoost);
    }
    if (typeof effects.scaleFactorBump === "number") {
      cs._scaleFactor = cs._scaleFactor * (1 + effects.scaleFactorBump);
    }
    if (typeof effects.localEntropyDecrease === "number") {
      cs.entropy = Math.max(0, cs.entropy + effects.localEntropyDecrease);
    }
    if (typeof effects.entropy === "number") {
      cs.entropy = Math.max(0, cs.entropy + effects.entropy);
    }
    if (typeof effects.starDeathCount === "number") {
      cs.starCount = Math.max(0, cs.starCount - effects.starDeathCount);
    }
    if (typeof effects.starFormationBurst === "number") {
      cs.starCount = cs.starCount + effects.starFormationBurst;
    }
    if (typeof effects.metallicityIncrease === "number") {
      cs.metallicity = this._clamp(cs.metallicity + effects.metallicityIncrease, 0, 1);
    }
    if (typeof effects.galaxyLoss === "number") {
      cs.galaxyCount = Math.max(0, cs.galaxyCount - effects.galaxyLoss);
    }
    if (typeof effects.habitabilityReduction === "number") {
      cs.habitableSystemsCount = Math.max(0, cs.habitableSystemsCount - effects.habitabilityReduction);
    }
    if (typeof effects.blackHoleFormation === "number") {
      cs.blackHoleCount = cs.blackHoleCount + effects.blackHoleFormation;
    }
  }

  // Neglected anomalies get WORSE, not better: age each unresolved anomaly,
  // bump severity at each threshold crossing, and let severe ones spawn a
  // nearby neighbor (contagion). Runs once per step. Returns spawned anomalies.
  escalateAndSpread() {
    const anomalies = this.universe.anomalies;
    const spawned = [];

    for (const a of anomalies) {
      if (a.resolved) continue;

      a.stepsUnresolved = (a.stepsUnresolved || 0) + 1;

      if (a.stepsUnresolved % STAB.ESCALATION_STEP_THRESHOLD === 0 && a.severity < 5) {
        a.severity += 1;
        recordEvent(this.universe, {
          type: "anomaly_escalated",
          description: `${a.description || a.type} intensified to severity ${a.severity}`,
          effects: { anomalyId: a.id, severity: a.severity }
        });
      }

      if (a.severity >= STAB.SPREAD_SEVERITY_MIN
          && this._rand() < STAB.SPREAD_CHANCE_PER_STEP
          && anomalies.length + spawned.length < MAX_ANOMALIES_PER_UNIVERSE) {
        spawned.push(this._spawnNeighbor(a));
      }
    }

    if (spawned.length > 0) {
      anomalies.push(...spawned);
      recordEvent(this.universe, {
        type: "anomaly_spread",
        description: `${spawned.length} new anomal${spawned.length === 1 ? "y" : "ies"} spread from unstable regions`,
        effects: { count: spawned.length }
      });
    }

    return spawned;
  }

  // A contagion child near its parent, two severity steps weaker, carrying no
  // instant cosmic effect - its danger is the ongoing drain and further growth.
  _spawnNeighbor(parent) {
    const angle = this._rand() * Math.PI * 2;
    const dist = (0.5 + this._rand() * 1.5) * CHUNK_SIZE;
    const px = parent.location?.x || 0;
    const py = parent.location?.y || 0;
    const severity = Math.max(1, (parent.severity || 2) - 2);
    return {
      id: this.options.anomalyIdFactory(),
      type: parent.type,
      category: parent.category,
      severity,
      timestamp: new Date(),
      resolved: false,
      effectsRaw: {},
      location: { x: px + Math.cos(angle) * dist, y: py + Math.sin(angle) * dist, z: (this._rand() - 0.5) * 1e4 },
      radius: 1000 * severity,
      description: parent.description,
      decayRate: 0,
      stepsUnresolved: 0,
    };
  }

  // rewardMultiplier: ship-upgrade bonus (Containment Rig), computed by the
  // route from the universe's persisted upgrade levels - never client input.
  resolveAnomaly(anomalyId, accuracy, rewardMultiplier = 1) {
    const anomaly = this.universe.anomalies.find(
      a => a.id === anomalyId || a._id?.toString() === anomalyId
    );

    if (!anomaly || anomaly.resolved) {
      return { success: false, reason: "Anomaly not found or already resolved" };
    }

    anomaly.resolved = true;
    anomaly.resolvedAt = new Date();

    const performanceMultiplier = getPerformanceMultiplier(accuracy);
    const totalMultiplier = performanceMultiplier * rewardMultiplier;

    const cs = this.universe.currentState;

    const severityMultiplier = anomaly.severity;
    const stabilityBoost = STAB.RESOLVE_REFILL_PER_SEVERITY * severityMultiplier * totalMultiplier;

    // Clamp to the health-derived ceiling, not a flat 1.0. Persists because
    // nothing recomputes the reservoir from scratch anymore.
    const ceiling = cs.stabilityCeiling ?? 1;
    cs.stabilityIndex = this._clamp(cs.stabilityIndex + stabilityBoost, 0, ceiling);

    const entropyReduction = 3e6 * severityMultiplier * totalMultiplier;
    cs.entropy = Math.max(0, cs.entropy - entropyReduction);

    cs.energyBudget = this._clamp(cs.energyBudget + 0.002 * severityMultiplier * totalMultiplier, 0, 1);

    this.universe.metrics.playerInterventions =
      (this.universe.metrics.playerInterventions || 0) + 1;
    this.universe.metrics.anomaliesResolved =
      (this.universe.metrics.anomaliesResolved || 0) + 1;

    const totalAnomalies = this.universe.anomalies.length;
    const resolvedCount = this.universe.anomalies.filter(a => a.resolved).length;
    this.universe.metrics.anomalyResolutionRate =
      totalAnomalies > 0 ? resolvedCount / totalAnomalies : 0;

    return {
      success: true,
      stabilityBoost,
      entropyReduction,
      performanceMultiplier,
      rewardMultiplier,
      accuracy: typeof accuracy === "number" ? Math.max(0, Math.min(100, accuracy)) : null,
      anomaly
    };
  }

  getAnomalyStats() {
    const anomalies = this.universe.anomalies || [];
    const active = anomalies.filter(a => !a.resolved);
    const resolved = anomalies.filter(a => a.resolved);

    const severityBreakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const a of active) {
      const sev = Math.floor(a.severity);
      severityBreakdown[sev] = (severityBreakdown[sev] || 0) + 1;
    }

    const categoryBreakdown = {};
    for (const a of active) {
      categoryBreakdown[a.category] = (categoryBreakdown[a.category] || 0) + 1;
    }

    return {
      total: anomalies.length,
      active: active.length,
      resolved: resolved.length,
      severityBreakdown,
      categoryBreakdown
    };
  }
}

module.exports = AnomalyGenerator;