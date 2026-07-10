// utils/hullCatalog.js
//
// Ship hull loadout: cosmetic, account-wide (lives on User, not Universe).
// Hulls unlock by tying to an achievement already tracked in
// utils/achievements.js - no separate unlock economy, no RP cost (RP is
// per-universe, so gating a cross-universe cosmetic behind it would be
// incoherent). The starter hull has no requirement.

const HULL_CATALOG = [
  { id: "interceptor", label: "Interceptor", tier: "starter", requiresAchievement: null,
    description: "Standard-issue survey vessel. Balanced and reliable." },
  { id: "cutter", label: "Cutter", tier: "bronze", requiresAchievement: "first-light",
    description: "Twin-prow forward hull, favored for close anomaly work." },
  { id: "cruiser", label: "Cruiser", tier: "silver", requiresAchievement: "not-alone",
    description: "Extended pod frame built for long first-contact runs." },
  { id: "hauler", label: "Hauler", tier: "gold", requiresAchievement: "taxonomist",
    description: "Reinforced industrial frame, wide cargo-rated stern." },
  { id: "vanguard", label: "Vanguard", tier: "platinum", requiresAchievement: "ascension",
    description: "Swept flagship hull. Worn only by those who witnessed transcendence." },
];

// Curated palette - every value already used elsewhere in the observatory
// design system, so no ship color can visually clash with the UI.
const COLOR_PALETTE = [
  "#dfa73f", // accent (default)
  "#4fd1a5", // good
  "#8b7bd8", // violet
  "#e0524a", // critical
  "#4ec9e0", // cyan
  "#9497ad", // ink-dim (stealth)
  "#f5cf7a", // gold-white
  "#e0824a", // warn
];

const HULL_MAP = Object.fromEntries(HULL_CATALOG.map((h) => [h.id, h]));

function isHullUnlocked(user, hullId) {
  const hull = HULL_MAP[hullId];
  if (!hull) return false;
  if (!hull.requiresAchievement) return true;
  return (user.achievements || []).some((a) => a.id === hull.requiresAchievement);
}

function unlockedHullIds(user) {
  return HULL_CATALOG.filter((h) => isHullUnlocked(user, h.id)).map((h) => h.id);
}

function validateLoadout(user, hull, shipColor) {
  if (!HULL_MAP[hull]) return { ok: false, reason: "Unknown hull" };
  if (!isHullUnlocked(user, hull)) return { ok: false, reason: "Hull not yet unlocked" };
  if (!COLOR_PALETTE.includes(shipColor)) return { ok: false, reason: "Invalid ship color" };
  return { ok: true };
}

module.exports = { HULL_CATALOG, COLOR_PALETTE, HULL_MAP, isHullUnlocked, unlockedHullIds, validateLoadout };
