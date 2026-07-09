// utils/missionSystem.js
//
// Generated objectives. A mission snapshots a metric's current value as
// `baseline` when issued; progress = current - baseline, complete when it
// reaches `target`. This means NO per-action hooks anywhere - every metric
// is derived from state the simulation already persists. Server is the
// authority on generation and claiming; the frontend mirrors the metric
// readers purely to render progress bars.

const sumCivs = (uni, pick) => (uni.civilizations || []).reduce((sum, c) => sum + pick(c), 0);

const METRICS = {
  anomaliesResolved: (uni) => uni.metrics?.anomaliesResolved || 0,
  discoveries: (uni) => uni.research?.discoveryCount || 0,
  classesDiscovered: (uni) => (uni.research?.classesDiscovered || []).length,
  civsObserved: (uni) => (uni.civilizations || []).filter((c) => c.observed).length,
  uplifts: (uni) => sumCivs(uni, (c) => c.uplifts || 0),
};

// `eligible` gates templates that need world state to be achievable (no
// survey missions before any civilization exists).
const TEMPLATES = [
  {
    id: "resolve", metric: "anomaliesResolved", counts: [2, 3, 5], rewardPer: 20,
    title: (n) => `Contain ${n} anomalies`,
    description: "Resolve anomalies with the containment minigames [F].",
  },
  {
    id: "catalog", metric: "discoveries", counts: [4, 8, 12], rewardPer: 8,
    title: (n) => `Catalog ${n} objects`,
    description: "Scan galaxies, nebulae or anomalies [V].",
  },
  {
    id: "classes", metric: "classesDiscovered", counts: [2, 3, 4], rewardPer: 30,
    title: (n) => `Discover ${n} new object classes`,
    description: "Scan object types you haven't cataloged before [V].",
  },
  {
    id: "survey", metric: "civsObserved", counts: [1, 2], rewardPer: 45,
    title: (n) => `Survey ${n} civilizations`,
    description: "Observe civilizations via First Contact [G].",
    eligible: (uni) => (uni.civilizations || []).some((c) => !c.extinct),
  },
  {
    id: "uplift", metric: "uplifts", counts: [1, 2], rewardPer: 90,
    title: (n) => `Perform ${n} uplifts`,
    description: "Transfer technology to a civilization [G]. Mind their aggression.",
    eligible: (uni) => (uni.civilizations || []).some((c) => !c.extinct),
  },
];

const MAX_ACTIVE = 3;
const CLAIMED_HISTORY_KEPT = 20;

function metricValue(uni, metric) {
  return METRICS[metric] ? METRICS[metric](uni) : 0;
}

function generateMission(uni, excludeTemplateIds = new Set(), rand = Math.random) {
  const pool = TEMPLATES.filter(
    (t) => !excludeTemplateIds.has(t.id) && (!t.eligible || t.eligible(uni))
  );
  if (pool.length === 0) return null;

  const template = pool[Math.floor(rand() * pool.length)];
  const n = template.counts[Math.floor(rand() * template.counts.length)];
  const baseline = metricValue(uni, template.metric);

  return {
    id: `msn_${Date.now()}_${Math.floor(rand() * 1e6)}`,
    templateId: template.id,
    title: template.title(n),
    description: template.description,
    metric: template.metric,
    baseline,
    target: baseline + n,
    reward: template.rewardPer * n,
    status: "active",
    issuedAt: new Date(),
  };
}

/**
 * Top up to MAX_ACTIVE missions, never repeating a template among the
 * active set. Also prunes old claimed history. Returns how many were added
 * so callers can skip saving when nothing changed.
 */
function ensureMissions(uni, rand = Math.random) {
  if (!Array.isArray(uni.missions)) uni.missions = [];

  const exclude = new Set(uni.missions.filter((m) => m.status === "active").map((m) => m.templateId));
  let added = 0;

  // exclude.size tracks the active-mission count as we add (templates are
  // unique among active missions); generateMission returns null once every
  // eligible template is taken, so this terminates even when fewer than
  // MAX_ACTIVE are possible
  while (exclude.size < MAX_ACTIVE) {
    const mission = generateMission(uni, exclude, rand);
    if (!mission) break;
    exclude.add(mission.templateId);
    uni.missions.push(mission);
    added++;
  }

  const claimed = uni.missions.filter((m) => m.status === "claimed");
  if (claimed.length > CLAIMED_HISTORY_KEPT) {
    const drop = new Set(claimed.slice(0, claimed.length - CLAIMED_HISTORY_KEPT).map((m) => m.id));
    uni.missions = uni.missions.filter((m) => !drop.has(m.id));
  }

  return added;
}

function missionProgress(uni, mission) {
  const needed = mission.target - mission.baseline;
  return Math.max(0, Math.min(needed, metricValue(uni, mission.metric) - mission.baseline));
}

/**
 * Claim a completed mission: validates completion against live state,
 * pays the reward, and issues a replacement. Mutates uni; caller saves.
 */
function claimMission(uni, missionId, rand = Math.random) {
  const mission = (uni.missions || []).find((m) => m.id === missionId);
  if (!mission) return { ok: false, reason: "Mission not found" };
  if (mission.status !== "active") return { ok: false, reason: "Mission already claimed" };
  if (metricValue(uni, mission.metric) < mission.target) {
    return { ok: false, reason: "Objective not yet complete" };
  }

  mission.status = "claimed";
  mission.completedAt = new Date();

  if (!uni.research) uni.research = {};
  uni.research.points = (uni.research.points || 0) + mission.reward;
  uni.research.totalEarned = (uni.research.totalEarned || 0) + mission.reward;

  ensureMissions(uni, rand);

  return { ok: true, mission, reward: mission.reward };
}

module.exports = { TEMPLATES, MAX_ACTIVE, metricValue, generateMission, ensureMissions, missionProgress, claimMission };
