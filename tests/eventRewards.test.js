// tests/eventRewards.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { claimEventReward, EVENT_REWARDS } = require("../utils/eventRewards");

const uni = () => ({ research: { points: 0, totalEarned: 0 }, eventRewards: {} });

test("valid claim grants RP and stamps the cooldown", () => {
  const u = uni();
  const r = claimEventReward(u, "supernova", 1000);
  assert.equal(r.ok, true);
  assert.equal(u.research.points, EVENT_REWARDS.supernova.rp);
  assert.equal(u.eventRewards.supernova, 1000);
});

test("claims inside the cooldown window are rejected without side effects", () => {
  const u = uni();
  claimEventReward(u, "comet", 1000);
  const r = claimEventReward(u, "comet", 1000 + EVENT_REWARDS.comet.cooldownMs - 1);
  assert.equal(r.ok, false);
  assert.equal(r.cooldown, true);
  assert.equal(u.research.points, EVENT_REWARDS.comet.rp); // only the first
});

test("claims after the cooldown succeed again", () => {
  const u = uni();
  claimEventReward(u, "derelict", 1000);
  const r = claimEventReward(u, "derelict", 1000 + EVENT_REWARDS.derelict.cooldownMs + 1);
  assert.equal(r.ok, true);
  assert.equal(u.research.points, EVENT_REWARDS.derelict.rp * 2);
});

test("unknown kinds are rejected", () => {
  assert.equal(claimEventReward(uni(), "blackhole-piñata").ok, false);
});
