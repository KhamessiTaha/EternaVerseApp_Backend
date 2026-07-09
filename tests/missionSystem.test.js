// tests/missionSystem.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ensureMissions, claimMission, missionProgress, MAX_ACTIVE } = require("../utils/missionSystem");

const uni = (over = {}) => ({
  metrics: { anomaliesResolved: 0 },
  research: { points: 0, totalEarned: 0, discoveryCount: 0, classesDiscovered: [] },
  civilizations: [],
  missions: [],
  ...over,
});

const active = (u) => u.missions.filter((m) => m.status === "active");

test("ensureMissions fills to exactly MAX_ACTIVE with unique templates", () => {
  const u = uni();
  const added = ensureMissions(u);
  assert.equal(added, MAX_ACTIVE);
  assert.equal(active(u).length, MAX_ACTIVE);
  const templates = active(u).map((m) => m.templateId);
  assert.equal(new Set(templates).size, templates.length);
  // No civs exist, so civ-gated templates must not be issued
  assert.ok(!templates.includes("survey") && !templates.includes("uplift"));
});

test("ensureMissions is idempotent when already full", () => {
  const u = uni();
  ensureMissions(u);
  assert.equal(ensureMissions(u), 0);
  assert.equal(active(u).length, MAX_ACTIVE);
});

test("progress is measured against the baseline, not absolute totals", () => {
  const u = uni({ metrics: { anomaliesResolved: 7 } });
  ensureMissions(u, () => 0); // deterministic: picks first eligible template ("resolve"), first count
  const m = u.missions.find((x) => x.templateId === "resolve");
  assert.equal(m.baseline, 7);
  assert.equal(missionProgress(u, m), 0);
  u.metrics.anomaliesResolved = 8;
  assert.equal(missionProgress(u, m), 1);
});

test("claim rejects incomplete missions and pays completed ones, then refills", () => {
  const u = uni();
  ensureMissions(u, () => 0);
  const m = u.missions.find((x) => x.templateId === "resolve");

  const early = claimMission(u, m.id);
  assert.equal(early.ok, false);

  u.metrics.anomaliesResolved = m.target;
  const claim = claimMission(u, m.id);
  assert.equal(claim.ok, true);
  assert.equal(u.research.points, m.reward);
  assert.equal(m.status, "claimed");
  assert.equal(active(u).length, MAX_ACTIVE); // replacement issued

  const again = claimMission(u, m.id);
  assert.equal(again.ok, false);
});

test("unknown mission ids are rejected", () => {
  const u = uni();
  assert.equal(claimMission(u, "msn_nope").ok, false);
});
