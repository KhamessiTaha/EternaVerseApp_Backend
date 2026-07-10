// utils/contactSystem.js
//
// First Contact actions - pure logic for POST /:id/contact-civilization.
// Mutates the civ + research on the passed universe (caller saves) and
// returns an outcome. The rand parameter exists so tests can force or
// forbid the uplift backfire.
//
// Design intent: the civ's stats are VISIBLE to the player before acting,
// and they matter - uplifting a warlike species can backfire, and the
// backfire chance is exactly proportional to the aggression stat shown in
// the panel. Informed gambles, not slot machines.

const OBSERVE_REWARDS = { Type0: 25, Type1: 50, Type2: 100, Type3: 200 };

const UPLIFT_BASE_COST = 60;
const PACIFY_BASE_COST = 50;
const MAX_USES = 3;

// Chance an uplift backfires = warlikeness * this factor (max 35% at
// full aggression). "They weaponized your gift."
const BACKFIRE_FACTOR = 0.35;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * How a civ regards the player, derived from relationship + temperament.
 * Mirrored on the frontend (game/utils.js civAttitude) for display and
 * beacon behavior - keep the two in sync.
 *  - worship: only pre-stellar civs (Type0/1) deify the sky-vessel
 *  - hostile: deeply wronged, or warlike and unimpressed - these SHOOT
 */
function civAttitude(civ) {
  const r = civ.relationship || 0;
  if ((civ.type === "Type0" || civ.type === "Type1") && r >= 0.45) return "worship";
  if (r >= 0.25) return "friendly";
  if (r <= -0.35 || ((civ.warlikeness ?? 0) > 0.75 && r < 0)) return "hostile";
  if (r <= -0.15 || (civ.warlikeness ?? 0) > 0.6) return "wary";
  return "neutral";
}

const shiftRelationship = (civ, delta) => {
  civ.relationship = clamp((civ.relationship || 0) + delta, -1, 1);
};

/** Deterministic display designation, mirrored by the frontend. */
function civDesignation(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = Math.abs(h);
  const letters = String.fromCharCode(65 + (h % 26)) + String.fromCharCode(65 + (Math.floor(h / 26) % 26));
  return `${letters}-${100 + (h % 900)}`;
}

function spendResearch(universe, cost) {
  const points = universe.research?.points || 0;
  if (points < cost) return false;
  universe.research.points = points - cost;
  return true;
}

function applyContact(universe, civId, action, rand = Math.random) {
  const civ = (universe.civilizations || []).find((c) => c.id === civId);
  if (!civ) return { ok: false, reason: "Civilization not found" };
  if (civ.extinct) return { ok: false, reason: "This civilization is extinct" };

  const name = civDesignation(civId);

  if (action === "observe") {
    if (civ.observed) return { ok: false, reason: "Survey already complete for this civilization" };

    const reward = OBSERVE_REWARDS[civ.type] ?? OBSERVE_REWARDS.Type0;
    civ.observed = true;
    shiftRelationship(civ, 0.05); // they noticed the watcher, and it flattered them
    if (!universe.research) universe.research = {};
    universe.research.points = (universe.research.points || 0) + reward;
    universe.research.totalEarned = (universe.research.totalEarned || 0) + reward;

    return {
      ok: true,
      action,
      outcome: "observed",
      reward,
      civ,
      message: `Ethnographic survey of ${name} complete (+${reward} RP)`
    };
  }

  if (action === "uplift") {
    if ((civ.uplifts || 0) >= MAX_USES) {
      return { ok: false, reason: "Further uplift would destabilize their development" };
    }
    const cost = UPLIFT_BASE_COST * ((civ.uplifts || 0) + 1);
    if (!spendResearch(universe, cost)) {
      return { ok: false, reason: `Insufficient research (${cost} RP required)` };
    }
    civ.uplifts = (civ.uplifts || 0) + 1;

    if (rand() < (civ.warlikeness ?? 0) * BACKFIRE_FACTOR) {
      civ.technology = clamp((civ.technology || 0) + 4, 0, 100);
      civ.warlikeness = clamp((civ.warlikeness || 0) + 0.12, 0, 1);
      civ.stability = clamp((civ.stability ?? 0.5) - 0.06, 0, 1);
      shiftRelationship(civ, -0.25); // the poisoned gift is not forgotten
      return {
        ok: true,
        action,
        outcome: "backfire",
        cost,
        civ,
        message: `${name} weaponized your gift - aggression rising`
      };
    }

    civ.technology = clamp((civ.technology || 0) + 8 + rand() * 6, 0, 100);
    civ.developmentLevel = clamp((civ.developmentLevel || 0) + 0.06, 0, 1);
    civ.stability = clamp((civ.stability ?? 0.5) + 0.08, 0, 1);
    shiftRelationship(civ, 0.18);
    return {
      ok: true,
      action,
      outcome: "uplifted",
      cost,
      civ,
      message: `${name} accepted the technology transfer - development accelerating`
    };
  }

  if (action === "pacify") {
    if ((civ.pacifies || 0) >= MAX_USES) {
      return { ok: false, reason: "Their culture has absorbed all it can" };
    }
    const cost = PACIFY_BASE_COST * ((civ.pacifies || 0) + 1);
    if (!spendResearch(universe, cost)) {
      return { ok: false, reason: `Insufficient research (${cost} RP required)` };
    }
    civ.pacifies = (civ.pacifies || 0) + 1;
    civ.warlikeness = clamp((civ.warlikeness || 0) - 0.18, 0, 1);
    civ.stability = clamp((civ.stability ?? 0.5) + 0.05, 0, 1);
    shiftRelationship(civ, 0.12);
    return {
      ok: true,
      action,
      outcome: "pacified",
      cost,
      civ,
      message: `Cultural exchange with ${name} is dampening their aggression`
    };
  }

  return { ok: false, reason: "Unknown contact action" };
}

module.exports = {
  applyContact,
  civDesignation,
  civAttitude,
  OBSERVE_REWARDS,
  UPLIFT_BASE_COST,
  PACIFY_BASE_COST,
  MAX_USES,
  BACKFIRE_FACTOR
};
