// utils/warStrike.js
//
// The consequence of shooting a civilization's ships.
//
// The client owns the dogfight (it renders it), but every lasting outcome is
// decided here: how far a people's regard for you falls, whether a war tips,
// and what the defended world thinks of the vessel that broke the siege. Pure
// over the universe document, so the rules are testable and the route stays a
// thin wrapper.
const { civDesignation } = require("./contactSystem");

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Per ship destroyed.
const RELATION_LOSS = 0.12;      // how much the struck people resent you
const RELATION_GRATITUDE = 0.15; // how much the defended people love you
const WAR_SCORE_SWING = 6;       // how hard one kill tips a war

/**
 * Apply a strike: `kills` ships belonging to `civId` were destroyed. When those
 * ships were RAIDING someone (`defendingCivId`), this is an intervention - the
 * war tips toward the defender and they remember who came.
 *
 * Returns { ok, message, effects } or { ok: false, reason }.
 */
function applyWarStrike(universe, civId, kills, { defendingCivId } = {}) {
  const civs = universe.civilizations || [];
  const struck = civs.find((c) => c.id === civId);
  if (!struck) return { ok: false, reason: "Civilization not found" };
  if (struck.extinct) return { ok: false, reason: "That civilization is already gone" };

  const n = clamp(Math.floor(kills || 0), 1, 20);
  const effects = { civId, kills: n };

  // The struck people take it personally, and militarize.
  struck.relationship = clamp((struck.relationship || 0) - RELATION_LOSS * n, -1, 1);
  struck.warlikeness = clamp((struck.warlikeness || 0) + 0.02 * n, 0, 1);
  struck.observed = true; // they have certainly seen you now
  effects.relationship = struck.relationship;

  // Did this break a siege? Only if the victims were raiding a real war target.
  const war = (universe.activeWars || []).find(
    (w) =>
      (w.a === civId && w.b === defendingCivId) ||
      (w.b === civId && w.a === defendingCivId)
  );

  let message = `You destroyed ${n} ${civDesignation(civId)} vessel${n === 1 ? "" : "s"}. They will not forget it.`;

  if (war && defendingCivId) {
    // Tip the war away from the people whose ships you burned.
    const swing = WAR_SCORE_SWING * n;
    if (war.a === defendingCivId) war.scoreA = (war.scoreA || 0) + swing;
    else war.scoreB = (war.scoreB || 0) + swing;
    effects.warId = war.id;
    effects.swing = swing;

    const defended = civs.find((c) => c.id === defendingCivId);
    if (defended && !defended.extinct) {
      defended.relationship = clamp((defended.relationship || 0) + RELATION_GRATITUDE * n, -1, 1);
      defended.observed = true;
      effects.defendedRelationship = defended.relationship;
      message =
        `You broke the siege of ${civDesignation(defendingCivId)} — ${n} ` +
        `${civDesignation(civId)} vessel${n === 1 ? "" : "s"} destroyed. A world remembers who came.`;
    }
  }

  return { ok: true, message, effects, brokeSiege: !!(war && defendingCivId) };
}

module.exports = {
  applyWarStrike,
  RELATION_LOSS,
  RELATION_GRATITUDE,
  WAR_SCORE_SWING,
};
