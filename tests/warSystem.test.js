// tests/warSystem.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { tickWars } = require("../utils/warSystem");
const { applyContact, ARM_COST, BROKER_COST } = require("../utils/contactSystem");

const civ = (id, over = {}) => ({
  id, type: "Type1", technology: 30, stability: 0.6, population: 1e8,
  warlikeness: 0.8, extinct: false, relationship: 0, ...over,
});

const uniAtWar = () => ({
  civilizations: [civ("civ_a"), civ("civ_b")],
  activeWars: [{ id: "war_1", a: "civ_a", b: "civ_b", scoreA: 0, scoreB: 0 }],
  research: { points: 1000, totalEarned: 1000 },
  metrics: {},
});

test("wars start between aggressive civs when the dice allow", () => {
  const u = { civilizations: [civ("civ_a"), civ("civ_b")], activeWars: [] };
  const events = tickWars(u, () => 0.0001); // every roll minimal -> start fires
  assert.equal(u.activeWars.length, 1);
  assert.ok(events.some((e) => /War erupts/.test(e.description)));
});

test("active wars grind both sides down each tick", () => {
  const u = uniAtWar();
  tickWars(u, () => 0.9); // high rolls: no end, no new war
  assert.ok(u.civilizations[0].stability < 0.6);
  assert.ok(u.civilizations[0].population < 1e8);
});

test("wars end with a winner and a mauled loser", () => {
  const u = uniAtWar();
  u.activeWars[0].scoreA = 100; // A is winning
  // Roll order per tick: scoreA, scoreB, end-check, then new-war picks/check
  const rolls = [0.9, 0.9, 0.001, 0.9, 0.9, 0.9];
  let i = 0;
  const events = tickWars(u, () => rolls[Math.min(i++, rolls.length - 1)]);
  assert.equal(u.activeWars.length, 0);
  assert.ok(events.some((e) => e.effects.outcome === "victory" && e.effects.winner === "civ_a"));
  assert.ok(u.civilizations[1].population < 1e8 * 0.7); // loser mauled
});

test("arm tips the score, costs RP, and makes an enemy of the other side", () => {
  const u = uniAtWar();
  const r = applyContact(u, "civ_a", "arm");
  assert.equal(r.ok, true);
  assert.equal(u.research.points, 1000 - ARM_COST);
  assert.ok(u.activeWars[0].scoreA >= 45);
  assert.ok(u.civilizations[0].relationship > 0);
  assert.ok(u.civilizations[1].relationship < 0); // the enemy remembers
});

test("broker ends the war, heals both sides, and counts toward missions", () => {
  const u = uniAtWar();
  const r = applyContact(u, "civ_b", "broker");
  assert.equal(r.ok, true);
  assert.equal(u.activeWars.length, 0);
  assert.equal(u.research.points, 1000 - BROKER_COST);
  assert.equal(u.metrics.warsBrokered, 1);
  assert.ok(u.civilizations[0].relationship > 0 && u.civilizations[1].relationship > 0);
});

test("arm/broker are rejected for civs not at war", () => {
  const u = uniAtWar();
  u.activeWars = [];
  assert.equal(applyContact(u, "civ_a", "arm").ok, false);
  assert.equal(applyContact(u, "civ_a", "broker").ok, false);
});
