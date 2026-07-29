// utils/doctrineCatalog.js
//
// Doctrines: the build-identity layer. The four upgrade TRACKS are linear
// fine-tuning; a doctrine is a single mutually-exclusive commitment with real
// TRADEOFFS - the same philosophy as the hull roster (a Falcon is fast AND
// fragile). You are a scanner boat that can't fight, or a containment tank
// that can't run. Switchable (respec-friendly): the identity is in the
// tradeoff you're living with, not in lock-in.
//
// Server-authoritative fields here are only what the server actually applies:
// `containment` folds into the anomaly-resolution reward (mirrors the
// Containment Rig hook). Movement/scan multipliers are applied client-side
// from the mirrored frontend copy; they're listed here so the two stay in
// sync and tests can assert the whole contract.

// Each doctrine lists multiplier DELTAS from stock (1.0). Omitted fields = 1.0.
const DOCTRINES = {
  surveyor: {
    label: "Deep-Field Surveyor",
    tagline: "See everything, contain nothing.",
    effects: { scanRange: 1.5, scanDuration: 0.7, maxSpeed: 1.1, containment: 0.7 },
    boons: ["+50% scan range", "−30% scan time", "+10% top speed"],
    banes: ["−30% anomaly-containment reward"],
  },
  warden: {
    label: "Containment Warden",
    tagline: "The wall the universe breaks against.",
    effects: { containment: 1.6, thrust: 0.85, maxSpeed: 0.8, boostRecharge: 0.9 },
    boons: ["+60% anomaly-containment reward"],
    banes: ["−20% top speed", "−15% thrust", "−10% boost recharge"],
  },
  voidrunner: {
    label: "Voidrunner",
    tagline: "Outrun the collapse; leave the mopping to others.",
    effects: { thrust: 1.35, maxSpeed: 1.3, boostRecharge: 1.4, containment: 0.75, scanRange: 0.85 },
    boons: ["+35% thrust", "+30% top speed", "+40% boost recharge"],
    banes: ["−25% containment reward", "−15% scan range"],
  },
};

const MODIFIER_FIELDS = ["thrust", "maxSpeed", "boostRecharge", "scanRange", "scanDuration", "containment"];

/** Full multiplier set for a doctrine id (defaults to all-1.0 / "none"). */
function doctrineModifiers(doctrine) {
  const base = Object.fromEntries(MODIFIER_FIELDS.map((f) => [f, 1]));
  const effects = DOCTRINES[doctrine]?.effects;
  if (!effects) return base;
  return { ...base, ...effects };
}

function isValidDoctrine(doctrine) {
  return doctrine === null || doctrine === "none" || Object.prototype.hasOwnProperty.call(DOCTRINES, doctrine);
}

module.exports = { DOCTRINES, MODIFIER_FIELDS, doctrineModifiers, isValidDoctrine };
