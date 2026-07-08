// utils/researchValues.js
//
// Server-authoritative research-point catalog. Mirrors the frontend's
// src/components/game/world/researchValues.js the same way PERFORMANCE_TIERS
// mirror GRADE_TIERS: this copy decides what is actually awarded; the
// frontend copy only drives generation and display. If they diverge, that's
// a balance bug to fix, not an API contract to enforce.

const gal = (label, rarity, research) => ({ category: "galaxy", label, rarity, research });

const OBJECT_CLASSES = {
  E0: gal("Elliptical (E0)", "common", 6),
  E1: gal("Elliptical (E1)", "common", 6),
  E2: gal("Elliptical (E2)", "common", 6),
  E3: gal("Elliptical (E3)", "common", 6),
  E4: gal("Elliptical (E4)", "uncommon", 12),
  E5: gal("Elliptical (E5)", "uncommon", 12),
  E6: gal("Elliptical (E6)", "uncommon", 14),
  E7: gal("Elliptical (E7)", "uncommon", 14),
  S0: gal("Lenticular (S0)", "uncommon", 12),
  Sa: gal("Spiral (Sa)", "common", 8),
  Sb: gal("Spiral (Sb)", "common", 6),
  Sc: gal("Spiral (Sc)", "common", 6),
  SBa: gal("Barred Spiral (SBa)", "uncommon", 10),
  SBb: gal("Barred Spiral (SBb)", "common", 8),
  SBc: gal("Barred Spiral (SBc)", "common", 8),
  Irr: gal("Irregular (Irr)", "common", 7),
  nebula: { category: "nebula", label: "Emission Nebula", rarity: "common", research: 8 },
  quasar: { category: "phenomenon", label: "Quasar (AGN)", rarity: "exceptional", research: 50 },
  merger: { category: "phenomenon", label: "Galaxy Merger", rarity: "rare", research: 40 },
};

const ANOMALY_SCAN_BASE = 15;

const getClassInfo = (objectClass) => OBJECT_CLASSES[objectClass] ?? null;

module.exports = { OBJECT_CLASSES, ANOMALY_SCAN_BASE, getClassInfo };
