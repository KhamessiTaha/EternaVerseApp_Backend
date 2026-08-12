// utils/openingSiege.js
//
// The scripted first siege.
//
// The fleet-combat pillar only exists once somebody can reach another star: a
// Type II. Left to the simulation that lands around step ~215 (civs can't
// emerge before CIV_START_GYR, then ~130 steps of tech growth to cross
// TIER_THRESHOLDS.Type2, then a 5%/step promotion roll), which is far beyond a
// first session. A new player would therefore never see the most dramatic
// content in the game.
//
// So the FIRST siege is scripted and every one after it is natural - exactly
// the bargain ChunkSystem.forcedAnomaly already strikes for the First Light
// anomaly, which exists so a new warden always has an obvious first target.
//
// Shape of the staged scenario, and why:
//   attacker  Type II - the only tier that can project force at another world
//   defender  Type I  - so ONLY the defender reads as besieged (a Type I
//                       raises no raid wave, so civUnderSiege never flags the
//                       attacker back). One victim, one aggressor, one
//                       distress call: a legible first lesson instead of two
//                       worlds pointing at each other.
//
// The defender's home fleet is one or two interceptors against bombers and an
// escort - hopeless on its own. That is the point. The player is the variable.
//
// Nothing here spawns anything: the caller owns the PhysicsEngine and hands us
// the two fresh civilizations, so all the RULES stay pure and testable.
const { civDesignation } = require("./contactSystem");

const ATTACKER_TIER = "Type2";
const ATTACKER_TECH = 55;
const DEFENDER_TIER = "Type1";
const DEFENDER_TECH = 25;
const WARLIKENESS = 0.7;

/**
 * Should we stage it? Once per universe, and only when the player has already
 * met a civilization - a world in danger means nothing to someone who has not
 * yet learned that worlds are inhabited.
 */
function shouldStageOpeningSiege(universe) {
  if (!universe || universe.scriptedSiegeAt) return false;
  if (universe.status === "ended") return false;

  const civs = universe.civilizations || [];
  const living = civs.filter((c) => !c.extinct);

  // The player has to have met somebody first.
  if (!living.some((c) => c.observed)) return false;

  // If the simulation has already produced a star-faring power, sieges can
  // happen on their own - don't manufacture one on top.
  if (living.some((c) => c.type === "Type2" || c.type === "Type3")) return false;

  return true;
}

/**
 * Promote a freshly-spawned pair into the opening scenario and declare the
 * war. `pair` is [defender, attacker]. Returns { war, defender, attacker,
 * message } or null if the caller couldn't supply two civilizations.
 */
function stageOpeningSiege(universe, pair, now = new Date()) {
  const [defender, attacker] = pair || [];
  if (!defender || !attacker || defender.id === attacker.id) return null;

  defender.type = DEFENDER_TIER;
  defender.technology = Math.max(defender.technology || 0, DEFENDER_TECH);

  attacker.type = ATTACKER_TIER;
  attacker.technology = Math.max(attacker.technology || 0, ATTACKER_TECH);
  attacker.warlikeness = Math.max(attacker.warlikeness || 0, WARLIKENESS);

  const war = {
    id: `war_${now.getTime()}_opening`,
    a: defender.id,
    b: attacker.id,
    scoreA: 0,
    scoreB: 0,
    startedAt: now,
    // The client uses this to teach the mechanic on the first siege only.
    scripted: true,
  };
  if (!Array.isArray(universe.activeWars)) universe.activeWars = [];
  universe.activeWars.push(war);
  universe.scriptedSiegeAt = now;

  const message =
    `${civDesignation(attacker.id)} has crossed into this region in force. ` +
    `${civDesignation(defender.id)} — a young world, barely off its own soil — ` +
    `is in the way.`;

  return { war, defender, attacker, message };
}

module.exports = {
  shouldStageOpeningSiege,
  stageOpeningSiege,
  ATTACKER_TIER,
  DEFENDER_TIER,
};
