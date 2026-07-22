const seedrandom = require("seedrandom");
const { recordEvent } = require("./eventLog");
const { civDesignation, civAttitude } = require("./contactSystem");
const STAB = require("./stabilityConfig");
const { tickWars } = require("./warSystem");

/**
 * Enhanced PhysicsEngine with improved civilization lifecycle management
 * - Prevents civilization bloat through natural attrition
 * - Implements realistic extinction events
 * - Caps maximum civilizations to prevent database overload
 */
class PhysicsEngine {
  constructor(universe, options = {}) {
    if (!universe) throw new Error("PhysicsEngine requires a universe object");

    this.universe = universe;
    
    this.options = {
      timeStepYears: options.timeStepYears ?? 1e7,
      maxScaleFactorExp: 50,
      seed: options.seed ?? universe?.seed ?? "default-seed",
      difficultyModifier: options.difficultyModifier ?? 1.0,
      enableProgressiveEvents: options.enableProgressiveEvents ?? true,
      maxCivilizations: options.maxCivilizations ?? 500, // PREVENT BLOAT
      civilizationCullInterval: options.civilizationCullInterval ?? 10, // Steps between culling
      ...options,
    };

    this.rng = seedrandom(this.options.seed);
    this.stepsSinceLastCull = 0; // Track culling frequency

    // Initialize constants with proper defaults
    const uniConstants = universe.constants || {};
    this.constants = {
      H0_km_s_Mpc: uniConstants.H0_km_s_Mpc ?? 67.4,
      H0: ((uniConstants.H0_km_s_Mpc ?? 67.4) / 3.08567758128e19) * 3.15576e7,
      c: uniConstants.speedOfLight ?? 2.99792458e8,
      G: uniConstants.gravitationalConstant ?? 6.67430e-11,
      darkMatterDensity: uniConstants.darkMatterDensity ?? 0.26,
      darkEnergyDensity: uniConstants.darkEnergyDensity ?? 0.69,
      baryonicDensity: uniConstants.matterDensity ?? 0.05,
      observableGalaxies: uniConstants.observableGalaxies ?? 2e11,
      averageStarsPerGalaxy: uniConstants.averageStarsPerGalaxy ?? 1e10,
      planckTemperature: uniConstants.planckTemperature ?? 1.417e32,
    };

    this._initializeState();
    this._initializeTracking();
  }

  _initializeState() {
    this.universe.currentState = this.universe.currentState || {};
    const cs = this.universe.currentState;
    
    cs.age = typeof cs.age === "number" ? cs.age : 0;
    cs._scaleFactor = cs._scaleFactor ?? 1.0;
    cs.expansionRate = cs.expansionRate ?? this.constants.H0_km_s_Mpc;
    cs.temperature = cs.temperature ?? (this.universe.initialConditions?.initialTemperature ?? 2.725);
    cs.entropy = cs.entropy ?? 0;
    cs.stabilityIndex = cs.stabilityIndex ?? 1.0;
    cs.galaxyCount = cs.galaxyCount ?? 0;
    cs.starCount = cs.starCount ?? 0;
    cs.blackHoleCount = cs.blackHoleCount ?? 0;
    cs.habitableSystemsCount = cs.habitableSystemsCount ?? 0;
    cs.lifeBearingPlanetsCount = cs.lifeBearingPlanetsCount ?? 0;
    cs.civilizationCount = cs.civilizationCount ?? 0;
    cs.metallicity = cs.metallicity ?? 0;
    
    // NEW: Track civilization statistics
    cs.civilizationsCreated = cs.civilizationsCreated ?? 0;
    cs.civilizationsExtinct = cs.civilizationsExtinct ?? 0;
    
    // Enhanced state tracking
    cs.cosmicPhase = cs.cosmicPhase ?? "dark_ages";
    cs.stellarGenerations = cs.stellarGenerations ?? 0;
    cs.energyBudget = cs.energyBudget ?? 1.0;

    // Persistent-reservoir bookkeeping
    cs.criticalSteps = cs.criticalSteps ?? 0;
    cs.stabilityCeiling = cs.stabilityCeiling ?? 1.0;

    if (!Array.isArray(this.universe.anomalies)) this.universe.anomalies = [];
    if (!Array.isArray(this.universe.significantEvents)) this.universe.significantEvents = [];
    if (!Array.isArray(this.universe.civilizations)) this.universe.civilizations = [];
    this.universe.metrics = this.universe.metrics || {};
  }

  _initializeTracking() {
    this.stabilityHistory = [];
    this.maxHistoryLength = 100;
    
    this.milestones = this.universe.milestones || {
      firstGalaxy: false,
      firstStar: false,
      firstLife: false,
      firstCivilization: false,
      stellarPopulationI: false,
      complexLifeEra: false,
      technologicalSingularity: false,
      greatFilter: false, // NEW: Mass extinction event
      transcendence: false // NEW: Type 3 civilization achievement
    };
    
    if (!this.universe.milestones) {
      this.universe.milestones = this.milestones;
    } else {
      this.milestones = this.universe.milestones;
    }
    
    this._deduplicateMilestones();
  }

  // ========== Helper Methods ==========
  _rand() {
    return this.rng();
  }

  _clamp(v, min = -Infinity, max = Infinity) {
    return Math.max(min, Math.min(max, v));
  }

  _safeExp(x) {
    if (x > this.options.maxScaleFactorExp) return Math.exp(this.options.maxScaleFactorExp);
    if (x < -this.options.maxScaleFactorExp) return 0;
    return Math.exp(x);
  }

  _gaussianRandom(mean = 0, stdDev = 1) {
    const u1 = this._rand();
    const u2 = this._rand();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  // ========== Core Physics Modules ==========

  _updateExpansion() {
    const dt = this.options.timeStepYears;
    const cs = this.universe.currentState;
    
    cs.age += dt;
    cs._scaleFactor = cs._scaleFactor ?? 1.0;

    const H0 = this.constants.H0;
    const a = cs._scaleFactor;
    
    const matterTerm = (this.constants.darkMatterDensity + this.constants.baryonicDensity) / Math.pow(a, 3);
    const radiationTerm = 0.0001 / Math.pow(a, 4);
    const darkTerm = this.constants.darkEnergyDensity;
    
    const H_eff = H0 * Math.sqrt(Math.max(0, matterTerm + radiationTerm + darkTerm));
    
    const expansionFactor = H_eff * dt;
    const cappedExpansion = this._clamp(expansionFactor, -0.1, 0.1);
    const growth = this._safeExp(cappedExpansion);
    
    cs._scaleFactor = this._clamp(cs._scaleFactor * growth, 1e-10, 1e10);
    cs.expansionRate = H_eff * 3.08567758128e19 / 3.15576e7;

    const T0 = this.universe.initialConditions?.initialTemperature ?? 2.725;
    cs.temperature = this._clamp(T0 / cs._scaleFactor, 0.01, T0 * 100);

    const volumeRatio = Math.pow(cs._scaleFactor, 3);
    const entropyGrowth = Math.log(Math.max(1, volumeRatio)) * 1e5 * (dt / 1e8);
    cs.entropy = this._clamp(cs.entropy + entropyGrowth, 0, 1e16);
    
    const energyDecay = 5e-13 * dt;
    cs.energyBudget = this._clamp(cs.energyBudget - energyDecay, 0, 1.0);
    
    this._updateCosmicPhase();
  }

  _updateCosmicPhase() {
    const cs = this.universe.currentState;
    const ageGyr = cs.age / 1e9;
    
    if (ageGyr < 0.1) cs.cosmicPhase = "dark_ages";
    else if (ageGyr < 1) cs.cosmicPhase = "reionization";
    else if (ageGyr < 5) cs.cosmicPhase = "galaxy_formation";
    else if (ageGyr < 10) cs.cosmicPhase = "stellar_peak";
    else if (ageGyr < 50) cs.cosmicPhase = "gradual_decline";
    else if (ageGyr < 100) cs.cosmicPhase = "twilight_era";
    else cs.cosmicPhase = "degenerate_era";
  }

  _updateStructures() {
    const cs = this.universe.currentState;
    const age = cs.age;
    const dt = this.options.timeStepYears;
    const ageGyr = age / 1e9;

    // Galaxy formation
    const K = this.constants.observableGalaxies;
    const formationPeak = Math.exp(-Math.pow((ageGyr - 5) / 3, 2));
    const baseRate = 0.15 / 1e9;
    const r = baseRate * (1 + formationPeak * 2);
    const current = cs.galaxyCount;
    
    let dG = 0;
    
    if (ageGyr > 0.1 && ageGyr < 2.5 && current < 1000) {
      const seedRate = 2000 * Math.exp(-Math.pow((ageGyr - 0.5) / 0.7, 2));
      dG = seedRate * (dt / 1e7);
    } else if (current > 0) {
      dG = r * current * (1 - current / Math.max(1, K)) * dt;
    }
    
    if (ageGyr > 1.0 && current < 100) {
      dG += 100;
    }
  
    cs.galaxyCount = this._clamp(current + dG, 0, K * 1.5);
    
    if (cs.galaxyCount >= 1 && !this.milestones.firstGalaxy) {
      this._recordMilestone('firstGalaxy', "First Galaxy Formation", 
        "The first galaxy has formed from primordial gas clouds");
    }

    // Star formation
    const starsPerGalaxy = this.constants.averageStarsPerGalaxy;
    const starsTarget = cs.galaxyCount * starsPerGalaxy;
    
    if (cs.galaxyCount > 0) {
      const metallicityBoost = 1 + cs.metallicity * 0.5;
      const gasFraction = Math.exp(-ageGyr / 10);
      const sfRate = 0.003 * gasFraction * metallicityBoost;
      
      const starGrowth = (starsTarget - cs.starCount) * sfRate * (dt / 1e7);
      cs.starCount = Math.max(0, cs.starCount + starGrowth);
      
      if (ageGyr > 0.5 && cs.galaxyCount > 10 && cs.starCount < 1e6) {
        cs.starCount += 1e6;
      }
      
      if (cs.starCount >= 1 && !this.milestones.firstStar) {
        this._recordMilestone('firstStar', "First Star Ignition", 
          "The first stars have ignited, ending the cosmic dark ages");
      }
    }
    
    // Stellar evolution
    if (cs.starCount > 0) {
      const stellarDeathRate = cs.starCount * 1e-11 * dt;
      const generationIncrease = stellarDeathRate / (starsPerGalaxy * 10);
      cs.stellarGenerations = Math.min(cs.stellarGenerations + generationIncrease, 10);
      
      const metalProduction = stellarDeathRate * 1e-14;
      cs.metallicity = this._clamp(cs.metallicity + metalProduction, 0, 1);
      
      if (cs.metallicity > 0.1 && !this.milestones.stellarPopulationI) {
        this._recordMilestone('stellarPopulationI', "Population I Stars", 
          "Metal-rich stars capable of forming rocky planets");
      }
    }

    // Black hole formation
    if (cs.starCount > 0) {
      const massiveStarFraction = 1e-4;
      const bhFormationRate = 0.1;
      const newBHs = cs.starCount * massiveStarFraction * bhFormationRate * (dt / 1e9);
      cs.blackHoleCount = Math.max(0, cs.blackHoleCount + newBHs);
    }
  }

  _recordMilestone(milestoneKey, title, description) {
    if (this.milestones[milestoneKey]) return;
    
    this.milestones[milestoneKey] = true;
    
    if (typeof this.universe.markModified === "function"){
      this.universe.markModified('milestones');
    }
    
    this._recordSignificantEvent("milestone", `MILESTONE: ${title}`, { 
      description,
      milestoneKey
    });
    
    console.log(`🎯 MILESTONE ACHIEVED: ${title} (${milestoneKey})`);
  }

  _recordSignificantEvent(type, description, effects) {
    recordEvent(this.universe, { type, description, effects });
  }

  _updateLifeEvolution() {
    const cs = this.universe.currentState;
    const age = cs.age;
    const dt = this.options.timeStepYears;
    const ageGyr = age / 1e9;

    if (ageGyr < 1 || cs.metallicity < 0.01) return;

    // Habitable systems
    const metallicityFactor = this._clamp(cs.metallicity / 0.3, 0, 1);
    const maturityFactor = Math.min(1, (ageGyr - 1) / 3);
    const habitableFraction = 0.001 + metallicityFactor * maturityFactor * 0.015;
    
    cs.habitableSystemsCount = Math.max(0, cs.starCount * habitableFraction);

    // Life emergence
    if (ageGyr > 3 && cs.habitableSystemsCount > 100) {
      const timeFactor = this._clamp((ageGyr - 3) / 5, 0, 1);
      const temperatureFactor = this._getTemperatureSuitability();
      // Was 1e-8: life-bearing worlds accumulated so slowly the civ-spawn
      // threshold below was decades of wall-clock away
      const lifeProbPerHabitable = 1e-7 * timeFactor * metallicityFactor * temperatureFactor;
      
      const deltaLife = cs.habitableSystemsCount * lifeProbPerHabitable * (dt / 1e8);
      cs.lifeBearingPlanetsCount = Math.max(0, cs.lifeBearingPlanetsCount + deltaLife);
      
      if (cs.lifeBearingPlanetsCount >= 1 && !this.milestones.firstLife) {
        this._recordMilestone('firstLife', "Abiogenesis Event", 
          "Life has emerged in the universe");
      }
      
      if (cs.lifeBearingPlanetsCount > 1000 && !this.milestones.complexLifeEra) {
        this._recordMilestone('complexLifeEra', "Complex Life Era", 
          "Complex multicellular life is widespread");
      }
    }

    // ==================== CIVILIZATION MANAGEMENT ====================
    this._manageCivilizations(ageGyr, dt);
  }

  _manageCivilizations(ageGyr, dt) {
    const cs = this.universe.currentState;
    
    if (ageGyr < 5 || cs.lifeBearingPlanetsCount < 1000) return;

    // 1. CALCULATE EXPECTED CIVILIZATIONS (not actual spawning).
    // Was 1e-7: one civilization per TEN MILLION life-bearing planets -
    // natural civs effectively never emerged (every civ in the game came
    // from the dev console). Now one per ~10k, so the life era actually
    // produces societies on its own.
    const civProb = 1e-4 * (1 + cs.metallicity * 0.5);
    const expectedCivs = Math.floor(cs.lifeBearingPlanetsCount * civProb);
    
    // 2. ENFORCE HARD CAP
    const activeCivs = this.universe.civilizations.filter(c => !c.extinct).length;
    const maxCivs = this.options.maxCivilizations;
    
    // 3. SPAWN NEW CIVILIZATIONS (only if under cap and needed)
    if (expectedCivs > cs.civilizationCount && activeCivs < maxCivs) {
      const needToAdd = Math.min(
        expectedCivs - cs.civilizationCount,
        maxCivs - activeCivs,
        10 // Max 10 per step to prevent spam
      );
      
      if (needToAdd > 0) {
        this._spawnCivilizations(needToAdd, ageGyr);
        cs.civilizationCount += needToAdd;
        cs.civilizationsCreated = (cs.civilizationsCreated || 0) + needToAdd;
      }
    }
    
    // 4. EVOLVE EXISTING CIVILIZATIONS
    this._evolveCivilizations(dt, ageGyr);
    
    // 5. PERIODIC CULLING (natural attrition)
    this.stepsSinceLastCull++;
    if (this.stepsSinceLastCull >= this.options.civilizationCullInterval) {
      this._cullCivilizations();
      this.stepsSinceLastCull = 0;
    }
    
    // 6. CATASTROPHIC EVENTS (rare mass extinctions)
    this._checkCatastrophicEvents(ageGyr);
  }

  _spawnCivilizations(count, ageGyr) {
    // New civilizations emerge a few chunks from the player's last known
    // position (same convention as anomalies) so First Contact beacons are
    // reachable by exploration rather than scattered across infinity.
    // civSpawnRange (chunks) is overridable - dev spawns use a tight range
    // so test civs are immediately findable.
    const CHUNK_SIZE = 1000;
    const origin = this.options.playerPosition || { x: 0, y: 0 };
    const range = this.options.civSpawnRange || { min: 2, max: 8 };

    for (let i = 0; i < count; i++) {
      const civType = this._determineCivilizationType(ageGyr);
      const angle = this._rand() * Math.PI * 2;
      const distance = (range.min + this._rand() * (range.max - range.min)) * CHUNK_SIZE;

      this.universe.civilizations.push({
        id: `civ_${Date.now()}_${this._rand().toString(36).substr(2, 9)}`,
        type: civType,
        createdAt: new Date(),
        age: 0,
        developmentLevel: this._rand(),
        technology: this._rand() * 10,
        stability: 0.5 + this._rand() * 0.5,
        population: Math.floor(1e6 + this._rand() * 1e9),
        resourceDepletion: 0,
        warlikeness: this._rand(),
        extinct: false,
        location: {
          x: origin.x + Math.cos(angle) * distance,
          y: origin.y + Math.sin(angle) * distance
        },
        observed: false,
        uplifts: 0,
        pacifies: 0
      });
    }
    
    const cs = this.universe.currentState;
    
    // Milestone: First civilization
    if (cs.civilizationCount >= 1 && !this.milestones.firstCivilization) {
      this._recordMilestone('firstCivilization', "First Civilization", 
        "Intelligent civilization has emerged");
    }
  }

  /**
   * Civilization drama. Rare, state-gated flavor events that shift real
   * stats and land in the Chronicle - the "Solar 2 layer" where the sim
   * reacts to how the player has treated each civ. Worshipping civs pay
   * research tribute; wronged ones stew. Probabilities are per simulation
   * step (~30s wall-clock), tuned so an active universe produces a few of
   * these per real-world hour, not a spam feed.
   */
  _maybeCivilizationEvent(civ) {
    const name = civDesignation(civ.id);
    const attitude = civAttitude(civ);
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const emit = (description, effects = {}) =>
      this._recordSignificantEvent("civilization", description, { civilizationId: civ.id, ...effects });

    // Worship tribute: the faithful tithe to the sky-vessel
    if (attitude === "worship" && this._rand() < 0.02) {
      const tribute = 4 + Math.floor(this._rand() * 10);
      if (!this.universe.research) this.universe.research = {};
      this.universe.research.points = (this.universe.research.points || 0) + tribute;
      this.universe.research.totalEarned = (this.universe.research.totalEarned || 0) + tribute;
      emit(`The faithful of ${name} burn offerings to the sky-vessel (+${tribute} RP tribute)`, { tribute });
      return;
    }

    // Monument to the player
    if (attitude === "worship" && this._rand() < 0.004) {
      civ.relationship = clamp((civ.relationship || 0) + 0.05, -1, 1);
      emit(`${name} completes a colossal monument depicting your ship. The likeness is... approximate.`);
      return;
    }

    // Religious schism over the true nature of the sky-vessel
    if (attitude === "worship" && this._rand() < 0.003) {
      civ.stability = clamp((civ.stability ?? 0.5) - 0.08, 0, 1);
      emit(`${name} splits into rival churches arguing over the true nature of the sky-vessel. Councils are held. Councils fail.`);
      return;
    }

    // Holy war waged in your name (worship + warlike = bad combination)
    if (attitude === "worship" && (civ.warlikeness ?? 0) > 0.5 && this._rand() < 0.003) {
      civ.population = Math.max(1e5, Math.floor((civ.population || 1e6) * 0.8));
      civ.warlikeness = clamp((civ.warlikeness || 0) + 0.08, 0, 1);
      emit(`${name} wages holy war in your name. You never asked for this.`);
      return;
    }

    // Civil war: unstable + populous
    if ((civ.stability ?? 0.5) < 0.45 && (civ.population || 0) > 1e6 && this._rand() < 0.004) {
      civ.population = Math.floor((civ.population || 1e6) * (0.6 + this._rand() * 0.25));
      civ.stability = clamp((civ.stability ?? 0.5) - 0.1, 0, 1);
      civ.technology = clamp((civ.technology || 0) + 2, 0, 100); // war is a grim accelerant
      emit(`Civil war erupts across ${name}. The reunification wars will advance their weapons by a generation.`);
      return;
    }

    // Golden age: stable and flourishing
    if ((civ.stability ?? 0.5) > 0.75 && this._rand() < 0.003) {
      civ.technology = clamp((civ.technology || 0) + 4, 0, 100);
      civ.population = Math.floor((civ.population || 1e6) * 1.15);
      emit(`${name} enters a golden age of science and art.`);
      return;
    }

    // Early rocketry (the Kerbal tribute)
    if (civ.type === "Type0" && (civ.technology || 0) > 12 && (civ.technology || 0) < 24 && this._rand() < 0.004) {
      civ.technology = clamp((civ.technology || 0) + 1, 0, 100);
      emit(`${name}'s first orbital rocket explodes on the pad. Undeterred, they schedule another launch.`);
      return;
    }

    // First satellite
    if (civ.type === "Type0" && (civ.technology || 0) >= 24 && (civ.technology || 0) < 30 && this._rand() < 0.004) {
      emit(`${name} places its first satellite in orbit. It does nothing but beep. They are beside themselves with pride.`);
      return;
    }

    // Grudge simmers: hostile civs radicalize slowly
    if (attitude === "hostile" && this._rand() < 0.002) {
      civ.warlikeness = clamp((civ.warlikeness || 0) + 0.04, 0, 1);
      emit(`${name} broadcasts a planetary address denouncing the sky-vessel. Military spending doubles.`);
    }
  }

  _evolveCivilizations(dt, ageGyr) {
    const cs = this.universe.currentState;

    // Interstellar wars: start/progress/resolve once per step (warSystem);
    // the player can tip or end them through First Contact
    for (const ev of tickWars(this.universe, () => this._rand())) {
      this._recordSignificantEvent("war", ev.description, ev.effects);
    }

    for (const civ of this.universe.civilizations) {
      if (civ.extinct) continue;
      
      civ.age += dt;

      // Technology advancement. Was 0.01 (~0.003/step): a civ's tech was
      // effectively frozen within any session and Type thresholds took
      // days of continuous simulation. Now ~0.02-0.06/step: visibly moves
      // every catch-up batch, thresholds reachable through the sweep.
      const techGrowth = 0.08 * (dt / 1e8) * (1 + (civ.developmentLevel ?? 0));
      civ.technology = Math.min(100, (civ.technology ?? 0) + techGrowth);

      // Resource depletion: consumption scales with how advanced and
      // populous they are (the old formula tracked tech GROWTH RATE and
      // moved ~1%/day of wall-clock - effectively frozen). The Kardashev
      // payoff: Type II+ civs tap stellar energy and slowly REVERSE their
      // depletion - uplifting a strained civ to Type II genuinely saves it.
      // stepScale normalizes across difficulty time steps.
      const stepScale = dt / 2e7;
      if (civ.type === "Type2" || civ.type === "Type3") {
        civ.resourceDepletion = Math.max(0, (civ.resourceDepletion ?? 0) - 0.0015 * stepScale);
      } else {
        const consumption =
          (((civ.technology ?? 0) / 100) * 0.0012 + 0.0002) *
          (1 + (civ.population || 0) / 5e9);
        civ.resourceDepletion = Math.min(1, (civ.resourceDepletion ?? 0) + consumption * stepScale);
      }
      
      // Population: grows under stability, shrinks under collapse. There
      // was NO growth mechanic before - populations only ever fell (wars,
      // events), so the number was a static label most of the time.
      const popDrift = 1 + 0.004 * stepScale * ((civ.stability ?? 0.5) - 0.4);
      civ.population = Math.floor(this._clamp((civ.population || 1e6) * popDrift, 1e4, 2e10));

      // Temperament drift: personalities wander slightly over time instead
      // of being fixed at birth forever
      civ.warlikeness = this._clamp((civ.warlikeness ?? 0.5) + this._gaussianRandom(0, 0.003), 0, 1);

      // Type progression. Old odds once tech-qualified: Type I ~8h of
      // continuous sim, Type II ~3.5 DAYS, Type III ~35 DAYS - transcendence
      // (and the Vanguard hull) was unreachable in practice. New odds:
      // ~1.7h / ~7h / ~21h of qualified simulation - rare, but real.
      if (civ.technology > 20 && civ.type === "Type0" && this._rand() < 0.005) {
        civ.type = "Type1";
        this._recordSignificantEvent("civilization", "Type I Civilization Achieved", {
          civilizationId: civ.id,
          description: "A civilization has achieved planetary energy mastery"
        });
      } else if (civ.technology > 50 && civ.type === "Type1" && this._rand() < 0.0012) {
        civ.type = "Type2";
        this._recordSignificantEvent("civilization", "Type II Civilization Achieved", {
          civilizationId: civ.id,
          description: "A civilization has achieved stellar energy mastery"
        });
      } else if (civ.technology > 80 && civ.type === "Type2" && this._rand() < 0.0004) {
        civ.type = "Type3";
        this._recordSignificantEvent("civilization", "Type III Civilization Achieved", {
          civilizationId: civ.id,
          description: "A civilization has achieved galactic energy mastery"
        });
        
        if (!this.milestones.transcendence) {
          this._recordMilestone('transcendence', "Transcendence", 
            "A civilization has transcended to Type III status");
        }
      }
      
      // Stability fluctuations
      const stabilityChange = this._gaussianRandom(0, 0.01);

      // Resource pressure reduces stability
      const resourcePressure = -(civ.resourceDepletion ?? 0) * 0.02;

      // War-like civilizations are less stable
      const warPressure = -(civ.warlikeness ?? 0) * 0.01;

      civ.stability = this._clamp((civ.stability ?? 0.5) + stabilityChange + resourcePressure + warPressure, 0, 1);

      // Civilization drama: rare per-step events that make civs feel alive
      // (civil wars, cults of the player, exploding rockets...)
      this._maybeCivilizationEvent(civ);
      
      // EXTINCTION EVENTS
      const extinctionChance = this._calculateExtinctionRisk(civ, cs);
      
      if (this._rand() < extinctionChance) {
        civ.extinct = true;
        civ.extinctionDate = new Date();
        civ.extinctionAge = civ.age;
        
        cs.civilizationsExtinct = (cs.civilizationsExtinct || 0) + 1;
        cs.civilizationCount = Math.max(0, cs.civilizationCount - 1);
        
        const extinctionType = this._determineExtinctionType(civ);
        
        this._recordSignificantEvent("extinction", `Civilization Extinction: ${extinctionType}`, {
          civilizationId: civ.id,
          type: civ.type,
          age: civ.age,
          technology: civ.technology,
          cause: extinctionType
        });
        
        console.log(`💀 Civilization extinct: ${civ.type} (${extinctionType}) after ${(civ.age / 1e6).toFixed(1)}M years`);
      }
    }
    
    // Check for technological singularity milestone
    const advancedCivs = this.universe.civilizations.filter(c => 
      !c.extinct && c.type !== "Type0"
    ).length;
    
    if (advancedCivs > 0 && !this.milestones.technologicalSingularity) {
      this._recordMilestone('technologicalSingularity', "Technological Singularity", 
        "Advanced civilizations have transcended planetary boundaries");
    }
  }

  _calculateExtinctionRisk(civ, cosmicState) {
    let baseRisk = 1e-5; // 0.001% per step

    // Low stability increases risk dramatically. NOTE: the <0.1 branch must
    // come first - it was previously shadowed by <0.3 and unreachable.
    if (civ.stability < 0.1) {
      baseRisk *= 100; // Almost certain extinction
    } else if (civ.stability < 0.3) {
      baseRisk *= (1 - civ.stability) * 50;
    }
    
    // Resource depletion is dangerous
    if ((civ.resourceDepletion ?? 0) > 0.8) {
      baseRisk *= 20;
    }

    // War-like civilizations destroy themselves
    if ((civ.warlikeness ?? 0) > 0.8) {
      baseRisk *= 10;
    }
    
    // Type 0 civilizations are most vulnerable
    if (civ.type === "Type0") {
      baseRisk *= 5;
    } else if (civ.type === "Type3") {
      baseRisk *= 0.1; // Type 3 civilizations are resilient
    }
    
    // Cosmic instability affects everyone
    if (cosmicState.stabilityIndex < 0.5) {
      baseRisk *= (1 - cosmicState.stabilityIndex) * 3;
    }
    
    // Age factor: very young and very old civilizations are at risk
    const ageMillions = civ.age / 1e6;
    if (ageMillions < 10) {
      baseRisk *= 2; // Young civilizations are fragile
    } else if (ageMillions > 1000) {
      baseRisk *= 1.5; // Old civilizations face stagnation
    }
    
    return Math.min(baseRisk, 0.5); // Cap at 50% per step
  }

  _determineExtinctionType(civ) {
    const r = this._rand();
    
    if (civ.stability < 0.2) {
      return r < 0.5 ? "Nuclear War" : "Civil Collapse";
    }
    
    if (civ.resourceDepletion > 0.8) {
      return "Resource Exhaustion";
    }
    
    if (civ.warlikeness > 0.8) {
      return "Self-Destruction";
    }
    
    if (r < 0.3) return "Pandemic";
    if (r < 0.5) return "Climate Catastrophe";
    if (r < 0.7) return "Asteroid Impact";
    if (r < 0.85) return "AI Singularity Failure";
    return "Unknown Event";
  }

  _cullCivilizations() {
    const before = this.universe.civilizations.length;
    
    // Remove extinct civilizations (keep last 100 for history)
    const extinctCivs = this.universe.civilizations.filter(c => c.extinct);
    const activeCivs = this.universe.civilizations.filter(c => !c.extinct);
    
    // Keep most recent 100 extinct civilizations for record-keeping
    // (civs that went extinct before extinctionDate was persisted sort last)
    const recentExtinct = extinctCivs
      .sort((a, b) => (b.extinctionDate?.getTime?.() ?? 0) - (a.extinctionDate?.getTime?.() ?? 0))
      .slice(0, 100);
    
    this.universe.civilizations = [...activeCivs, ...recentExtinct];
    
    const removed = before - this.universe.civilizations.length;
    
    if (removed > 0) {
      console.log(`🧹 Culled ${removed} ancient extinct civilizations (keeping ${recentExtinct.length} recent)`);
      
      if (typeof this.universe.markModified === "function") {
        this.universe.markModified('civilizations');
      }
    }
  }

  _checkCatastrophicEvents(ageGyr) {
    const cs = this.universe.currentState;
    
    // Great Filter event (rare mass extinction). Was 1e-6/step (~1M steps,
    // i.e. ~1 wall-clock YEAR of continuous simulation) - a dead milestone.
    // Now ~2e-5 with the existing 10+ active-civ requirement: rare, dreaded,
    // but genuinely possible in a mature universe.
    if (this._rand() < 2e-5 && !this.milestones.greatFilter) {
      const activeCivs = this.universe.civilizations.filter(c => !c.extinct);
      const killCount = Math.floor(activeCivs.length * (0.5 + this._rand() * 0.4));
      
      if (killCount > 10) {
        // Kill a percentage of civilizations
        const toKill = activeCivs.slice(0, killCount);
        
        for (const civ of toKill) {
          civ.extinct = true;
          civ.extinctionDate = new Date();
          civ.extinctionAge = civ.age;
          cs.civilizationsExtinct = (cs.civilizationsExtinct || 0) + 1;
          cs.civilizationCount = Math.max(0, cs.civilizationCount - 1);
        }
        
        this._recordMilestone('greatFilter', "The Great Filter", 
          `A cosmic catastrophe has destroyed ${killCount} civilizations`);
        
        this._recordSignificantEvent("catastrophe", "Great Filter Event", {
          civilizationsDestroyed: killCount,
          description: "A universe-wide catastrophic event has caused mass extinction"
        });
        
        console.log(`☠️  GREAT FILTER: ${killCount} civilizations destroyed`);
      }
    }
  }

  _determineCivilizationType(ageGyr) {
    const r = this._rand();
    
    if (ageGyr < 8) return "Type0";
    if (r < 0.98) return "Type0";
    if (r < 0.998) return "Type1";
    if (r < 0.9998) return "Type2";
    return "Type3";
  }

  _deduplicateMilestones() {
    const seenMilestones = new Set();
    const uniqueEvents = [];
    
    for (const event of this.universe.significantEvents) {
      if (event.type === 'milestone') {
        const milestoneText = event.description.replace('MILESTONE: ', '');
        
        if (!seenMilestones.has(milestoneText)) {
          seenMilestones.add(milestoneText);
          uniqueEvents.push(event);
          
          const milestoneKeyMap = {
            'First Galaxy Formation': 'firstGalaxy',
            'First Star Ignition': 'firstStar',
            'Population I Stars': 'stellarPopulationI',
            'Abiogenesis Event': 'firstLife',
            'Complex Life Era': 'complexLifeEra',
            'First Civilization': 'firstCivilization',
            'Technological Singularity': 'technologicalSingularity',
            'The Great Filter': 'greatFilter',
            'Transcendence': 'transcendence'
          };
          
          const milestoneKey = milestoneKeyMap[milestoneText];
          if (milestoneKey && this.milestones[milestoneKey] !== undefined) {
            this.milestones[milestoneKey] = true;
          }
        }
      } else {
        uniqueEvents.push(event);
      }
    }
    
    if (uniqueEvents.length < this.universe.significantEvents.length) {
      const removed = this.universe.significantEvents.length - uniqueEvents.length;
      console.log(`🧹 Removed ${removed} duplicate milestone events`);
      this.universe.significantEvents = uniqueEvents;
      if (typeof this.universe.markModified === "function"){
        this.universe.markModified('significantEvents');
        this.universe.markModified('milestones');
      }
    }
  }

  // Ceiling + slow metrics. Runs every step (inside simulateStep). Does NOT
  // touch the reservoir - anomalies drain it directly in applyStabilityDynamics.
  _updateCeilingAndMetrics() {
    const cs = this.universe.currentState;

    const entropyFactor = this._calculateEntropyFactor();
    const structureFactor = this._calculateStructureFactor();
    const darkEnergyFactor = this._calculateDarkEnergyFactor();
    const temperatureFactor = this._getTemperatureSuitability();
    const energyFactor = cs.energyBudget;

    // Old six-factor formula minus its 0.20 anomaly term, renormalized to
    // [0,1]: "how healthy is the cosmology, ignoring anomalies". This is the
    // ceiling the reservoir can regenerate toward.
    const ceilingHealth = (
      0.15 * entropyFactor +
      0.25 * structureFactor +
      0.15 * darkEnergyFactor +
      0.15 * temperatureFactor +
      0.10 * energyFactor
    ) / 0.80;

    cs.stabilityCeiling = this._clamp(
      STAB.CEILING_BASE + STAB.CEILING_SPAN * this._clamp(ceilingHealth, 0, 1),
      0, 1
    );

    this.universe.metrics.complexityIndex = this._calculateComplexityIndex();
    this.universe.metrics.lifePotentialIndex = this._calculateLifePotentialIndex();
    this.universe.metrics.cosmicHealth = this._calculateCosmicHealth();
  }

  // Reservoir update: drain from active anomalies, regen when calm, crisis
  // tracking. Runs ONCE per step in the runner, after anomalies are generated
  // and escalated. `offline` (cron sweep) softens drain, floors it, and never
  // arms the crisis counter.
  applyStabilityDynamics(options = {}) {
    const cs = this.universe.currentState;
    const offline = !!options.offline;
    const drainScale = options.drainScale ?? 1.0;
    const regenScale = options.regenScale ?? 1.0;

    const prev = cs.stabilityIndex ?? 1;
    const ceiling = cs.stabilityCeiling ?? 1;
    const active = this.universe.anomalies.filter(a => !a.resolved);

    let drain = active.reduce(
      (sum, a) => sum + STAB.STABILITY_DRAIN_PER_SEVERITY * (a.severity || 1),
      0
    ) * drainScale;

    if (offline) drain *= STAB.OFFLINE_DRAIN_SCALE;
    else if (prev < STAB.CRITICAL_THRESHOLD) drain *= STAB.CRITICAL_DRAIN_MULTIPLIER;

    const regen = (active.length <= STAB.REGEN_ANOMALY_THRESHOLD && prev < ceiling)
      ? STAB.STABILITY_REGEN * regenScale
      : 0;

    let next = this._clamp(prev - drain + regen, 0, ceiling);
    if (offline) {
      // Offline drain may lower toward the floor but never below it, and never
      // lifts a universe already parked below the floor.
      next = Math.max(next, Math.min(prev, STAB.OFFLINE_FLOOR));
    }
    cs.stabilityIndex = next;

    if (!offline) {
      if (next < STAB.CRITICAL_THRESHOLD) cs.criticalSteps = (cs.criticalSteps || 0) + 1;
      else if (next > STAB.CRISIS_CLEAR_THRESHOLD) cs.criticalSteps = 0;
      // between the two thresholds: hold the counter (hysteresis)
    }

    this.stabilityHistory.push(next);
    if (this.stabilityHistory.length > this.maxHistoryLength) this.stabilityHistory.shift();

    this.universe.metrics.stabilityScore = next;
    this.universe.metrics.stabilityTrend = this._calculateStabilityTrend();
  }

  // Back-compat: standalone callers (simulateSteps, ml/generate_dataset.js)
  // that don't run the runner loop still get a moving reservoir.
  _updateStability() {
    this._updateCeilingAndMetrics();
    this.applyStabilityDynamics({});
  }

  _calculateEntropyFactor() {
    const cs = this.universe.currentState;
    const maxEntropy = 3e14;
    return Math.max(0, 1 - Math.pow(cs.entropy / maxEntropy, 0.7));
  }

  _calculateStructureFactor() {
    const cs = this.universe.currentState;
    const ageGyr = cs.age / 1e9;
    
    const expectedGalaxies = this.constants.observableGalaxies * Math.min(ageGyr / 13.8, 1);
    const galaxyFactor = Math.min(1, cs.galaxyCount / Math.max(1, expectedGalaxies * 0.3));
    
    const expectedStars = cs.galaxyCount * this.constants.averageStarsPerGalaxy * 0.5;
    const starFactor = Math.min(1, cs.starCount / Math.max(1, expectedStars));
    
    return (galaxyFactor + starFactor) / 2;
  }

  _calculateDarkEnergyFactor() {
    const cs = this.universe.currentState;
    const a = cs._scaleFactor ?? 1;
    
    const matterDensity = (this.constants.darkMatterDensity + this.constants.baryonicDensity) / Math.pow(a, 3);
    const darkEnergyDensity = this.constants.darkEnergyDensity;
    const totalDensity = matterDensity + darkEnergyDensity;
    const deFraction = darkEnergyDensity / Math.max(1e-12, totalDensity);
    
    if (deFraction < 0.95) return 1.0;
    return Math.max(0, 1 - Math.pow((deFraction - 0.95) / 0.05, 2));
  }

  _calculateAnomalyFactor() {
    const unresolved = this.universe.anomalies.filter(a => !a.resolved).length;
    const total = this.universe.anomalies.length;
    
    const unresolvedImpact = Math.min(unresolved * 0.008, 0.35);
    const totalImpact = Math.min(total * 0.0015, 0.25);
    
    return Math.max(0, 1 - unresolvedImpact - totalImpact);
  }

  _calculateStabilityTrend() {
    if (this.stabilityHistory.length < 10) return 0;
    
    const recent = this.stabilityHistory.slice(-10);
    const older = this.stabilityHistory.slice(-20, -10);
    
    if (older.length === 0) return 0;
    
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    
    return recentAvg - olderAvg;
  }

  _getTemperatureSuitability() {
    const temp = this.universe.currentState.temperature;
    const optimal = 2.725;
    const tolerance = 5;
    return Math.exp(-Math.pow((temp - optimal) / tolerance, 2));
  }

  _calculateComplexityIndex() {
    const cs = this.universe.currentState;
    
    const g = Math.log10(Math.max(1, cs.galaxyCount)) / 12;
    const s = Math.log10(Math.max(1, cs.starCount)) / 23;
    const l = Math.log10(Math.max(1, cs.lifeBearingPlanetsCount + 1)) / 10;
    const c = Math.log10(Math.max(1, cs.civilizationCount + 1)) / 3;
    
    return this._clamp((g + s + l + c) / 4, 0, 1);
  }

  _calculateLifePotentialIndex() {
    const cs = this.universe.currentState;
    if (cs.starCount <= 0) return 0;
    
    const habitableFraction = cs.habitableSystemsCount / cs.starCount;
    const tempSuitability = this._getTemperatureSuitability();
    const stability = cs.stabilityIndex;
    const metallicityBonus = cs.metallicity;
    
    return this._clamp(
      (habitableFraction * 100 + tempSuitability + stability + metallicityBonus) / 4, 
      0, 
      1
    );
  }

  _calculateCosmicHealth() {
    const cs = this.universe.currentState;
    
    return this._clamp(
      (cs.stabilityIndex * 0.4 + 
       this._calculateComplexityIndex() * 0.3 + 
       this._calculateLifePotentialIndex() * 0.3),
      0,
      1
    );
  }

  // ========== Public API =================================================================

  simulateStep() {
    this._updateExpansion();
    this._updateStructures();
    this._updateLifeEvolution();
    // Ceiling + metrics only. The reservoir (drain/regen/crisis) is advanced
    // once per step by the runner via applyStabilityDynamics, after anomalies
    // for this step have been generated and escalated.
    this._updateCeilingAndMetrics();

    this.universe.lastModified = new Date();

    return { 
      universe: this.universe,
      metrics: this.universe.metrics,
      milestones: this.milestones
    };
  }

  simulateSteps(n = 1) {
    const stepsToRun = Math.max(1, Math.floor(n));
    
    for (let i = 0; i < stepsToRun; i++) {
      this.simulateStep();
    }
    
    return { 
      universe: this.universe,
      metrics: this.universe.metrics,
      milestones: this.milestones,
      stabilityHistory: this.stabilityHistory
    };
  }

  getStatistics() {
    const cs = this.universe.currentState;
    const ageGyr = cs.age / 1e9;
    
    const activeCivs = this.universe.civilizations.filter(c => !c.extinct).length;

    return {
      ageYears: cs.age,
      ageGyr: ageGyr.toFixed(3),
      cosmicPhase: cs.cosmicPhase,
      expansionRate: cs.expansionRate.toFixed(2),
      scaleFactor: cs._scaleFactor.toFixed(6),
      temperature: cs.temperature.toFixed(6),
      entropy: cs.entropy.toExponential(3),
      energyBudget: (cs.energyBudget * 100).toFixed(1) + "%",
      
      // Structure
      galaxies: this._formatLargeNumber(cs.galaxyCount),
      stars: this._formatLargeNumber(cs.starCount),
      blackHoles: this._formatLargeNumber(cs.blackHoleCount),
      metallicity: (cs.metallicity * 100).toFixed(2) + "%",
      stellarGenerations: cs.stellarGenerations.toFixed(2),
      
      // Life
      habitableSystems: this._formatLargeNumber(cs.habitableSystemsCount),
      lifeBearingPlanets: this._formatLargeNumber(cs.lifeBearingPlanetsCount),
      civilizations: cs.civilizationCount,
      civilizationsActive: activeCivs,
      civilizationsExtinct: cs.civilizationsExtinct || 0,
      civilizationsCreated: cs.civilizationsCreated || 0,
      advancedCivilizations: this.universe.civilizations.filter(c => !c.extinct && c.type !== "Type0").length,
      
      // Stability & Health
      stability: (cs.stabilityIndex * 100).toFixed(2) + "%",
      stabilityTrend: this._formatTrend(this.universe.metrics.stabilityTrend),
      cosmicHealth: (this.universe.metrics.cosmicHealth * 100).toFixed(1) + "%",
      
      // Anomalies
      anomaliesTotal: this.universe.anomalies.length,
      anomaliesActive: this.universe.anomalies.filter(a => !a.resolved).length,
      
      // Events & Metrics
      significantEvents: this.universe.significantEvents.length,
      metrics: this.universe.metrics,
      milestones: this.milestones,
      milestonesAchieved: Object.values(this.milestones).filter(Boolean).length
    };
  }

  _formatLargeNumber(num) {
    if (num < 1e3) return Math.floor(num).toString();
    if (num < 1e6) return (num / 1e3).toFixed(2) + "K";
    if (num < 1e9) return (num / 1e6).toFixed(2) + "M";
    if (num < 1e12) return (num / 1e9).toFixed(2) + "B";
    return num.toExponential(2);
  }

  _formatTrend(trend) {
    if (!trend) return "stable";
    if (trend > 0.05) return "improving rapidly";
    if (trend > 0.01) return "improving";
    if (trend > -0.01) return "stable";
    if (trend > -0.05) return "declining";
    return "declining rapidly";
  }

  getStabilityHistory() {
    return this.stabilityHistory;
  }

  // NEW: Get civilization statistics
  getCivilizationStats() {
    const civs = this.universe.civilizations;
    const active = civs.filter(c => !c.extinct);
    
    return {
      total: civs.length,
      active: active.length,
      extinct: civs.filter(c => c.extinct).length,
      byType: {
        type0: active.filter(c => c.type === "Type0").length,
        type1: active.filter(c => c.type === "Type1").length,
        type2: active.filter(c => c.type === "Type2").length,
        type3: active.filter(c => c.type === "Type3").length
      },
      averageAge: active.length > 0 
        ? active.reduce((sum, c) => sum + c.age, 0) / active.length / 1e6 
        : 0,
      averageStability: active.length > 0
        ? active.reduce((sum, c) => sum + c.stability, 0) / active.length
        : 0,
      mostAdvanced: active.sort((a, b) => b.technology - a.technology)[0] || null
    };
  }
}

module.exports = PhysicsEngine;