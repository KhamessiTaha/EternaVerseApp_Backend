// utils/upgradeCatalog.js
//
// Server-authoritative ship-upgrade catalog. Mirrors the frontend's
// src/components/game/content/upgradeCatalog.js the same way
// researchValues.js mirrors its frontend copy: this file decides what a
// purchase costs and whether it is allowed; the frontend copy only drives
// display and applies the client-side stat effects. If they diverge, that's
// a balance bug to fix, not an API contract to enforce.

// costs[n] is the price of going from level n to level n+1;
// max level is costs.length.
const UPGRADE_TRACKS = {
  thrusters: { label: "Ion Thrusters", costs: [40, 90, 180] },
  boostReactor: { label: "Boost Reactor", costs: [40, 90, 180] },
  scanner: { label: "Scanner Array", costs: [50, 110, 220] },
  containment: { label: "Containment Rig", costs: [60, 140, 280] },
};

// The one server-applied effect: each Containment Rig level adds this to the
// anomaly-resolution reward multiplier (level 3 = +24%). Client-side effects
// (thrust, boost, scanning) live in the frontend catalog.
const CONTAINMENT_BONUS_PER_LEVEL = 0.08;

/**
 * Pure purchase check - no mutation. Returns either
 * { ok: true, cost, nextLevel, label } or { ok: false, reason }.
 */
function validatePurchase(universe, track) {
  const info = UPGRADE_TRACKS[track];
  if (!info) {
    return { ok: false, reason: "Unknown upgrade track" };
  }

  const level = universe.upgrades?.[track] || 0;
  if (level >= info.costs.length) {
    return { ok: false, reason: `${info.label} is already at maximum level` };
  }

  const cost = info.costs[level];
  const points = universe.research?.points || 0;
  if (points < cost) {
    return { ok: false, reason: `Insufficient research: ${info.label} Mk ${level + 1} costs ${cost} RP` };
  }

  return { ok: true, cost, nextLevel: level + 1, label: info.label };
}

module.exports = { UPGRADE_TRACKS, CONTAINMENT_BONUS_PER_LEVEL, validatePurchase };
