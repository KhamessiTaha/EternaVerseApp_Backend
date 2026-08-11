// utils/bombardment.js
//
// What happens to a world when nobody stops the bombers.
//
// A siege the player can lose. The client renders the raid (bombers running on
// a world, defenders trying to stop them) and reports COMPLETED bombardment
// runs here; this module owns every lasting consequence, including the one
// that matters: a civilization can be wiped out while the player watches.
//
// Server-authoritative in the way that counts - a client cannot claim a world
// was bombed unless a war between the two peoples actually exists in the
// document. Pure over the universe, so the rules are testable and the route
// stays a thin wrapper.
//
// The numbers below MIRROR the client's combat/fleetModel.js (BOMBARD_POP_LOSS
// / BOMBARD_STABILITY_LOSS) the same way the grade and performance tier tables
// are mirrored. Change one, change the other.
const { civDesignation } = require("./contactSystem");

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Per completed bombardment run.
const BOMBARD_POP_LOSS = 0.14;        // fraction of the surviving population
const BOMBARD_STABILITY_LOSS = 0.06;  // the siege meter (see below)
const WAR_SCORE_SWING = 4;            // how far one run tips the war

// Stability is the siege meter: a bombardment breaks a society long before it
// kills the last person, so a world dies when its stability is ground to zero
// (~8-16 unopposed runs, i.e. roughly a minute of nobody intervening) or when
// too few are left to carry it on.
const POPULATION_FLOOR = 1e5;

// A client that vanishes mid-siege and reconnects must not be able to bank an
// hour of runs into one request.
const MAX_RUNS_PER_REPORT = 12;

/**
 * Apply `runs` completed bombardment runs by `attackerCivId` against `civId`.
 *
 * Returns { ok, message, effects, extinct } or { ok: false, reason }.
 */
function applyBombardment(universe, civId, runs, { attackerCivId } = {}) {
  const civs = universe.civilizations || [];
  const target = civs.find((c) => c.id === civId);
  if (!target) return { ok: false, reason: "Civilization not found" };
  if (target.extinct) return { ok: false, reason: "That civilization is already gone" };

  // The siege has to be real. No war, no bombardment.
  const war = (universe.activeWars || []).find(
    (w) =>
      (w.a === civId && w.b === attackerCivId) ||
      (w.b === civId && w.a === attackerCivId)
  );
  if (!war) return { ok: false, reason: "No war between those civilizations" };

  const n = clamp(Math.floor(runs || 0), 1, MAX_RUNS_PER_REPORT);

  const popBefore = target.population || 0;
  target.population = Math.max(0, Math.floor(popBefore * (1 - BOMBARD_POP_LOSS) ** n));
  target.stability = clamp((target.stability ?? 0.5) - BOMBARD_STABILITY_LOSS * n, 0, 1);
  target.observed = true;

  // The attacker gains ground for every run that lands.
  const swing = WAR_SCORE_SWING * n;
  if (war.a === attackerCivId) war.scoreA = (war.scoreA || 0) + swing;
  else war.scoreB = (war.scoreB || 0) + swing;

  const effects = {
    civId,
    attackerCivId,
    runs: n,
    populationLost: popBefore - target.population,
    stability: target.stability,
    warId: war.id,
  };

  const broken = target.stability <= 0 || target.population < POPULATION_FLOOR;
  if (!broken) {
    return {
      ok: true,
      extinct: false,
      message:
        `${civDesignation(attackerCivId)} vessels are bombarding ${civDesignation(civId)}. ` +
        `${formatPop(effects.populationLost)} dead.`,
      effects,
    };
  }

  // The world is lost.
  target.extinct = true;
  target.extinctionDate = new Date();
  target.extinctionAge = target.age;
  target.population = 0;
  effects.extinct = true;

  // Nothing left to fight over: the war ends with the attacker holding the field.
  universe.activeWars = (universe.activeWars || []).filter((w) => w !== war);

  const cs = universe.currentState;
  if (cs) {
    cs.civilizationsExtinct = (cs.civilizationsExtinct || 0) + 1;
    cs.civilizationCount = Math.max(0, (cs.civilizationCount || 1) - 1);
  }

  return {
    ok: true,
    extinct: true,
    message:
      `${civDesignation(civId)} has been bombarded into extinction by ` +
      `${civDesignation(attackerCivId)}. The war is over. Nobody won it.`,
    effects,
  };
}

function formatPop(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} billion`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} million`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} thousand`;
  return `${Math.max(0, Math.floor(n))}`;
}

module.exports = {
  applyBombardment,
  BOMBARD_POP_LOSS,
  BOMBARD_STABILITY_LOSS,
  WAR_SCORE_SWING,
  POPULATION_FLOOR,
  MAX_RUNS_PER_REPORT,
};
