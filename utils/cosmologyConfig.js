// utils/cosmologyConfig.js
//
// THE CALIBRATION TARGET, and every constant derived from it.
//
//   One universe runs ~400 simulation steps from Big Bang to a Type III
//   Ascension. At SECONDS_PER_STEP = 30 that is ~2-4 hours of ACTIVE play
//   (there is no background sweep - universes only advance while played).
//
// Everything below is tuned so the milestones land inside that budget:
//
//   step   ~20   first galaxies seeded
//   step   ~75   life becomes possible (metallicity + age gates open)
//   step  ~130   first civilizations emerge
//   step  ~370   a shepherded civilization can reach Type III
//
// WHY THIS FILE EXISTS: the original constants were written as if a universe
// experienced astronomically many steps. Against the few hundred a player
// actually sees, every variable either never moved (energy, entropy, anomaly
// spawns, ascension) or slammed into its clamp within a few Gyr (metallicity,
// civilization count). Keeping the calibration in one place - with the target
// written down - is what stops that drift from recurring. If you change
// STEPS_TO_ASCENSION, re-derive; don't hand-tune one constant in isolation.

// The budget every rate below is derived from.
const STEPS_TO_ASCENSION = 400;

// --- Cosmic clock ----------------------------------------------------------
// Years of cosmic time per simulation step, per difficulty. Chosen so a
// 400-step universe spans a recognizable cosmic lifetime (12-24 Gyr) and the
// age-gated eras (life at 3 Gyr, civilizations at 4 Gyr) open early enough to
// leave room for the whole Kardashev climb.
const TIME_STEP_YEARS = {
  Beginner: 6e7,      // 400 steps = 24 Gyr - eras arrive soonest
  Intermediate: 4e7,  // 400 steps = 16 Gyr
  Advanced: 3e7,      // 400 steps = 12 Gyr - least cosmic time to succeed
};

// The reference step used when a rate is expressed "per Intermediate step",
// so difficulty scales rates instead of silently changing pacing.
const REFERENCE_DT = TIME_STEP_YEARS.Intermediate;

// --- Structure formation ---------------------------------------------------
// Logistic galaxy growth. Tuned so galaxyCount approaches observableGalaxies
// during the formation era (~step 150-200) instead of needing ~1000+ steps -
// the old rate left galaxyCount at ~1e-7 of its target forever, which in turn
// zeroed both the anomaly spawn rate and the structure half of stability.
const GALAXY_BASE_RATE = 1.2e-9;   // was 1.5e-10 (0.15/1e9)

// --- Chemical enrichment ---------------------------------------------------
// Metallicity is a fraction of SOLAR metallicity (Z/Z_sun), not "percent of
// the universe that is metal". It saturates logistically: each stellar
// generation enriches less as the gas reservoir depletes. The old version was
// an unbounded linear accumulator clamped at 1, so it read "100%" within a few
// Gyr and stayed there.
const ENRICHMENT_RATE = 0.004;     // per reference step, scaled by gas fraction

// --- Free energy -----------------------------------------------------------
// The slow march toward heat death. Old decay was 1e-5/step, needing 100,000
// steps to empty - which also made the heat-death and stellar-death end
// conditions (energy < 0.05 / < 0.08) unreachable. Now a universe visibly dims
// across its life and a very long one can actually die of exhaustion.
const ENERGY_DECAY = 0.0016;       // per reference step, rises with age

// --- Entropy ---------------------------------------------------------------
// Entropy accumulates from the expanding volume. Rather than inventing a new
// growth constant, the REFERENCE SCALES are aligned to what entropy actually
// reaches (~1e7-1e8 over a long universe) so the entropy term in stability and
// the maximum-entropy end condition both become live instead of decorative.
// Measured against a real tended run: entropy reaches ~9e7 by step 400. The
// reference is set so the entropy term declines GRADUALLY across a universe's
// life (factor ~0.7 mid-life, ~0.3 late) instead of either sitting at 1.0
// forever (the old 3e14) or saturating to 0 by mid-game.
const ENTROPY_REFERENCE = 1.5e8;   // stability's "max entropy" (was 3e14)
const ENTROPY_DEATH = 4e8;         // end-condition threshold (was 2e15)
// Entropy repaid by containing an anomaly. Was 3e6 per severity point, which
// against the real entropy scale meant one containment zeroed the counter.
const ENTROPY_PER_RESOLVE = 5e5;   // per severity point, x performance

// --- Life & civilizations --------------------------------------------------
const LIFE_START_GYR = 3;          // abiogenesis becomes possible
const CIV_START_GYR = 4;           // first societies can emerge
// Civilizations arrive on a bounded SCHEDULE rather than as a raw fraction of
// an exponentially-growing life count. The old formula (life x 1e-4) crossed
// the population cap almost instantly and spawned 10 per step, which is why
// ~500 civilizations appeared at once.
const CIVS_PER_GYR = 2.5;
const MAX_CIVILIZATIONS = 40;      // was 500 - a readable galaxy, not a swarm
const MAX_CIV_SPAWNS_PER_STEP = 1; // was 10

// --- The Kardashev climb (the main goal) -----------------------------------
// Budget: a civilization born ~step 130 must be able to reach Type III by
// ~step 370. Baseline tech growth covers 0->100 in ~215 steps; the tier gates
// add ~65 steps of variance. A player's uplifts shave ~70 steps off, which is
// what makes shepherding your chosen species meaningfully faster than watching
// a wild one.
const TECH_PER_STEP = 0.42;        // per reference step, x (0.6 + developmentLevel)
const TIER_THRESHOLDS = { Type1: 20, Type2: 50, Type3: 80 };
const TIER_CHANCE = {              // per-step chance once the tech gate is met
  Type1: 0.08,                     // ~12 steps
  Type2: 0.05,                     // ~20 steps
  Type3: 0.03,                     // ~33 steps
};

// --- Anomalies -------------------------------------------------------------
// Spawn "activity" now ramps with cosmic age instead of galaxyCount/2e11 -
// that ratio never exceeded ~1e-7, making the per-type spawn chance ~1e-8 and
// natural anomalies effectively impossible.
const ACTIVITY_START_GYR = 0.3;
const ACTIVITY_FULL_GYR = 4.3;     // activity ramps 0 -> 1 across this window

// Expected anomalies across a 400-step universe: ~18 (Beginner), ~44
// (Intermediate), ~106 (Advanced).
const ANOMALY_PROBABILITY_SCALE = {
  Beginner: 0.001,
  Intermediate: 0.0025,
  Advanced: 0.006,
};

// Severity distribution at spawn. ~15% arrive at 4+, so rift sieges (which
// need severity >= 4) appear naturally instead of only via 15-step escalation.
function rollSeverity(rand) {
  const roll = rand();
  if (roll < 0.45) return 1 + Math.floor(rand() * 2); // 1-2, the common case
  if (roll < 0.85) return 3;
  if (roll < 0.97) return 4;
  return 5;
}

module.exports = {
  STEPS_TO_ASCENSION,
  TIME_STEP_YEARS,
  REFERENCE_DT,
  GALAXY_BASE_RATE,
  ENRICHMENT_RATE,
  ENERGY_DECAY,
  ENTROPY_REFERENCE,
  ENTROPY_DEATH,
  ENTROPY_PER_RESOLVE,
  LIFE_START_GYR,
  CIV_START_GYR,
  CIVS_PER_GYR,
  MAX_CIVILIZATIONS,
  MAX_CIV_SPAWNS_PER_STEP,
  TECH_PER_STEP,
  TIER_THRESHOLDS,
  TIER_CHANCE,
  ACTIVITY_START_GYR,
  ACTIVITY_FULL_GYR,
  ANOMALY_PROBABILITY_SCALE,
  rollSeverity,
};
