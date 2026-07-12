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
  pacifies: (uni) => sumCivs(uni, (c) => c.pacifies || 0),
  researchEarned: (uni) => Math.floor(uni.research?.totalEarned || 0),
  rareFinds: (uni) => (uni.discoveries || []).filter((d) => d.rarity === "rare" || d.rarity === "exceptional").length,
  worshippers: (uni) => (uni.civilizations || []).filter(
    (c) => !c.extinct && (c.type === "Type0" || c.type === "Type1") && (c.relationship || 0) >= 0.45
  ).length,
  ageMyr: (uni) => Math.floor((uni.currentState?.age || 0) / 1e6),
  warsBrokered: (uni) => uni.metrics?.warsBrokered || 0,
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
  {
    id: "pacify", metric: "pacifies", counts: [1, 2], rewardPer: 70,
    title: (n) => `Broker peace ${n} time${n > 1 ? "s" : ""}`,
    description: "Pacify aggressive civilizations [G] before they destroy themselves.",
    eligible: (uni) => (uni.civilizations || []).some((c) => !c.extinct && (c.warlikeness ?? 0) > 0.3),
  },
  {
    id: "research", metric: "researchEarned", counts: [150, 300, 600], rewardPer: 0.3,
    title: (n) => `Accumulate ${n} research`,
    description: "Any source counts: scans, surveys, objectives, tribute.",
  },
  {
    id: "rare-finds", metric: "rareFinds", counts: [1, 2], rewardPer: 60,
    title: (n) => `Catalog ${n} rare-class object${n > 1 ? "s" : ""}`,
    description: "Scan until you find something the codex flags as rare or exceptional [V].",
  },
  {
    id: "worship", metric: "worshippers", counts: [1], rewardPer: 150,
    title: () => `Be worshipped by a civilization`,
    description: "Treat a young civilization well enough [G] that they deify your ship.",
    eligible: (uni) => (uni.civilizations || []).some(
      (c) => !c.extinct && (c.type === "Type0" || c.type === "Type1") && (c.relationship || 0) < 0.45
    ),
  },
  {
    id: "shepherd", metric: "ageMyr", counts: [200, 400, 800], rewardPer: 0.15,
    title: (n) => `Shepherd the universe through ${n} million years`,
    description: "Time passes even while you're away - the simulation never sleeps.",
  },
  {
    id: "war-broker", metric: "warsBrokered", counts: [1], rewardPer: 140,
    title: () => `Broker an end to a war`,
    description: "Two civilizations are killing each other [G]. Make them stop.",
    eligible: (uni) => (uni.activeWars || []).length > 0,
  },
];

const MAX_ACTIVE = 3;
const CLAIMED_HISTORY_KEPT = 20;

function metricValue(uni, metric) {
  return METRICS[metric] ? METRICS[metric](uni) : 0;
}

function generateMission(uni, excludeTemplateIds = new Set(), rand = Math.random) {
  // Variety guard: don't immediately re-issue what the player just finished.
  // The 2 most recently claimed templates sit out - unless that would leave
  // nothing to offer.
  const recentlyClaimed = (uni.missions || [])
    .filter((m) => m.status === "claimed")
    .slice(-2)
    .map((m) => m.templateId);

  let pool = TEMPLATES.filter(
    (t) => !excludeTemplateIds.has(t.id) && (!t.eligible || t.eligible(uni))
  );
  const varied = pool.filter((t) => !recentlyClaimed.includes(t.id));
  if (varied.length > 0) pool = varied;
  if (pool.length === 0) return null;

  const template = pool[Math.floor(rand() * pool.length)];

  // Escalation: each completed run of a template advances it to its next
  // count tier; past the last tier the count stays but the reward keeps
  // growing (+20% per extra completion, capped at 2x) - repeats become
  // bigger asks with bigger payouts instead of identical chores.
  const timesClaimed = (uni.missions || []).filter(
    (m) => m.status === "claimed" && m.templateId === template.id
  ).length;
  const tier = Math.min(timesClaimed, template.counts.length - 1);
  const n = template.counts[tier];
  const overflow = Math.max(0, timesClaimed - (template.counts.length - 1));
  const rewardMult = Math.min(2, 1 + overflow * 0.2);
  const baseline = metricValue(uni, template.metric);

  return {
    id: `msn_${Date.now()}_${Math.floor(rand() * 1e6)}`,
    templateId: template.id,
    title: template.title(n),
    description: template.description,
    metric: template.metric,
    baseline,
    target: baseline + n,
    reward: Math.round(template.rewardPer * n * rewardMult),
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
