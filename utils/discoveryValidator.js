// utils/discoveryValidator.js
//
// Pure validation/normalization for POST /:id/discoveries. Takes the raw
// client batch and the universe (only .discoveries and .anomalies are read)
// and returns normalized discovery docs with SERVER-computed research values.
// Duplicates are not errors: retries after a lost ack must be harmless.
const { OBJECT_CLASSES, ANOMALY_SCAN_BASE } = require("./researchValues");

const OBJ_ID_RE = /^obj:-?\d+:-?\d+:\d+$/;

// Server-authoritative research values for the deeper scales (mirror of
// frontend world/worldScales.js STAR_CLASSES / PLANET_CLASSES).
const STAR_CATALOG = {
  O: { research: 40, rarity: "exceptional" }, B: { research: 26, rarity: "rare" },
  A: { research: 16, rarity: "uncommon" }, F: { research: 12, rarity: "uncommon" },
  G: { research: 10, rarity: "common" }, K: { research: 8, rarity: "common" }, M: { research: 6, rarity: "common" },
};
const PLANET_CATALOG = {
  terran: { research: 20, rarity: "rare" }, ocean: { research: 14, rarity: "uncommon" },
  desert: { research: 8, rarity: "common" }, rocky: { research: 6, rarity: "common" },
  barren: { research: 5, rarity: "common" }, ice: { research: 7, rarity: "common" },
  gas: { research: 12, rarity: "uncommon" }, lava: { research: 11, rarity: "uncommon" },
};

const finiteXY = (loc) =>
  loc && typeof loc === "object" &&
  Number.isFinite(loc.x) && Number.isFinite(loc.y);

const severityRarity = (severity) =>
  severity >= 5 ? "exceptional" : severity >= 4 ? "rare" : severity >= 3 ? "uncommon" : "common";

const sanitizeName = (name, fallback) =>
  typeof name === "string" && name.trim().length > 0
    ? name.trim().slice(0, 32)
    : fallback;

function prepareDiscoveries(universe, rawList) {
  const accepted = [];
  const duplicates = [];
  const rejected = [];

  const known = new Set((universe.discoveries || []).map((d) => d.id));

  for (const raw of Array.isArray(rawList) ? rawList : []) {
    if (!raw || typeof raw.id !== "string" || !finiteXY(raw.location)) {
      rejected.push(raw && typeof raw.id === "string" ? raw.id : "(malformed)");
      continue;
    }

    if (known.has(raw.id)) {
      duplicates.push(raw.id);
      continue;
    }

    let doc = null;

    if (raw.category === "anomaly") {
      const anomaly = (universe.anomalies || []).find((a) => a.id === raw.id);
      if (anomaly) {
        const severity = Math.max(1, Math.floor(anomaly.severity || 1));
        doc = {
          id: raw.id,
          name: sanitizeName(raw.name, `Anomaly ${anomaly.type}`),
          category: "anomaly",
          objectClass: anomaly.type,
          rarity: severityRarity(severity),
          researchValue: ANOMALY_SCAN_BASE * severity,
        };
      }
    } else if (OBJ_ID_RE.test(raw.id)) {
      const info = OBJECT_CLASSES[raw.objectClass];
      if (info && info.category === raw.category) {
        doc = {
          id: raw.id,
          name: sanitizeName(raw.name, raw.objectClass),
          category: info.category,
          objectClass: raw.objectClass,
          rarity: info.rarity,
          researchValue: info.research,
        };
      }
    } else if (raw.category === "star" && STAR_CATALOG[raw.objectClass]) {
      const info = STAR_CATALOG[raw.objectClass];
      doc = {
        id: raw.id, name: sanitizeName(raw.name, raw.objectClass), category: "star",
        objectClass: raw.objectClass, rarity: info.rarity, researchValue: info.research,
      };
    } else if (raw.category === "planet" && PLANET_CATALOG[raw.objectClass]) {
      const info = PLANET_CATALOG[raw.objectClass];
      doc = {
        id: raw.id, name: sanitizeName(raw.name, raw.objectClass), category: "planet",
        objectClass: raw.objectClass, rarity: info.rarity, researchValue: info.research,
      };
    }

    if (!doc) {
      rejected.push(raw.id);
      continue;
    }

    doc.location = { x: raw.location.x, y: raw.location.y };
    doc.discoveredAt = new Date();
    known.add(doc.id); // in-batch dedup
    accepted.push(doc);
  }

  return { accepted, duplicates, rejected };
}

module.exports = { prepareDiscoveries };
