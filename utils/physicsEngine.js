const seedrandom = require("seedrandom");

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
    if (this.universe.significantEvents.length > 2000) {
      this.universe.significantEvents.splice(0, 500);
    }
    
    this.universe.significantEvents.push({
      timestamp: new Date(),
      age: this.universe.currentState.age,
      type,
      description,
      effects,
      ageGyr: (this.universe.currentState.age / 1e9).toFixed(3)
    });
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
      const lifeProbPerHabitable = 1e-8 * timeFactor * metallicityFactor * temperatureFactor;
      
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

    // 1. CALCULATE EXPECTED CIVILIZATIONS (not actual spawning)
    const civProb = 1e-7 * (1 + cs.metallicity * 0.5);
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
    for (let i = 0; i < count; i++) {
      const civType = this._determineCivilizationType(ageGyr);
      
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
        extinct: false
      });
    }
    
    const cs = this.universe.currentState;
    
    // Milestone: First civilization
    if (cs.civilizationCount >= 1 && !this.milestones.firstCivilization) {
      this._recordMilestone('firstCivilization', "First Civilization", 
        "Intelligent civilization has emerged");
    }
  }

  _evolveCivilizations(dt, ageGyr) {
    const cs = this.universe.currentState;
    
    for (const civ of this.universe.civilizations) {
      if (civ.extinct) continue;
      
      civ.age += dt;
      
      // Technology advancement
      const techGrowth = 0.01 * (dt / 1e8) * (1 + civ.developmentLevel);
      civ.technology = Math.min(100, civ.technology + techGrowth);
      
      // Resource depletion (increases with technology)
      civ.resourceDepletion = Math.min(1, civ.resourceDepletion + techGrowth * 0.005);
      
      // Type progression
      if (civ.technology > 20 && civ.type === "Type0" && this._rand() < 0.001) {
        civ.type = "Type1";
        this._recordSignificantEvent("civilization", "Type I Civilization Achieved", {
          civilizationId: civ.id,
          description: "A civilization has achieved planetary energy mastery"
        });
      } else if (civ.technology > 50 && civ.type === "Type1" && this._rand() < 0.0001) {
        civ.type = "Type2";
        this._recordSignificantEvent("civilization", "Type II Civilization Achieved", {
          civilizationId: civ.id,
          description: "A civilization has achieved stellar energy mastery"
        });
      } else if (civ.technology > 80 && civ.type === "Type2" && this._rand() < 0.00001) {
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
      const resourcePressure = -civ.resourceDepletion * 0.02;
      
      // War-like civilizations are less stable
      const warPressure = -civ.warlikeness * 0.01;
      
      civ.stability += stabilityChange + resourcePressure + warPressure;
      civ.stability = this._clamp(civ.stability, 0, 1);
      
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
    
    // Low stability increases risk dramatically
    if (civ.stability < 0.3) {
      baseRisk *= (1 - civ.stability) * 50;
    } else if (civ.stability < 0.1) {
      baseRisk *= 100; // Almost certain extinction
    }
    
    // Resource depletion is dangerous
    if (civ.resourceDepletion > 0.8) {
      baseRisk *= 20;
    }
    
    // War-like civilizations destroy themselves
    if (civ.warlikeness > 0.8) {
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
    const recentExtinct = extinctCivs
      .sort((a, b) => b.extinctionDate - a.extinctionDate)
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
    
    // Great Filter event (rare mass extinction)
    if (this._rand() < 1e-6 && !this.milestones.greatFilter) {
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

  _updateStability() {
    const cs = this.universe.currentState;

    const entropyFactor = this._calculateEntropyFactor();
    const structureFactor = this._calculateStructureFactor();
    const darkEnergyFactor = this._calculateDarkEnergyFactor();
    const temperatureFactor = this._getTemperatureSuitability();
    const anomalyFactor = this._calculateAnomalyFactor();
    const energyFactor = cs.energyBudget;

    let rawStability = 
      0.15 * entropyFactor +
      0.25 * structureFactor +
      0.15 * darkEnergyFactor +
      0.15 * temperatureFactor +
      0.20 * anomalyFactor +
      0.10 * energyFactor;

    const diffMod = this.options.difficultyModifier ?? 1.0;
    rawStability = rawStability * (0.6 + 0.4 / diffMod);

    cs.stabilityIndex = this._clamp(rawStability, 0, 1);
    
    this.stabilityHistory.push(cs.stabilityIndex);
    if (this.stabilityHistory.length > this.maxHistoryLength) {
      this.stabilityHistory.shift();
    }

    this.universe.metrics.stabilityScore = cs.stabilityIndex;
    this.universe.metrics.stabilityTrend = this._calculateStabilityTrend();
    this.universe.metrics.complexityIndex = this._calculateComplexityIndex();
    this.universe.metrics.lifePotentialIndex = this._calculateLifePotentialIndex();
    this.universe.metrics.cosmicHealth = this._calculateCosmicHealth();
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
    this._updateStability();

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
    const extinctCivs = this.universe.civilizations.filter(c => c.extinct).length;
    
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
      civilizationsExtinct: extinctCivs,
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