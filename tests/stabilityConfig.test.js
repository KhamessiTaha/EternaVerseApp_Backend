// tests/stabilityConfig.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const cfg = require("../utils/stabilityConfig");

test("core constants are present and sane", () => {
  assert.ok(cfg.STABILITY_DRAIN_PER_SEVERITY > 0);
  assert.ok(cfg.STABILITY_REGEN > 0);
  assert.ok(cfg.CRITICAL_THRESHOLD < cfg.CRISIS_CLEAR_THRESHOLD);
  assert.equal(cfg.CEILING_BASE + cfg.CEILING_SPAN, 1);
  assert.ok(cfg.OFFLINE_FLOOR > cfg.CRITICAL_THRESHOLD); // offline can't reach crisis
});

test("difficultyStability escalates harder tiers", () => {
  const b = cfg.difficultyStability("Beginner");
  const a = cfg.difficultyStability("Advanced");
  assert.ok(a.drainScale > b.drainScale);
  assert.ok(a.regenScale < b.regenScale);
  assert.ok(a.crisisWindow < b.crisisWindow);
  assert.deepEqual(cfg.difficultyStability("nonsense"), cfg.difficultyStability("Intermediate"));
});
