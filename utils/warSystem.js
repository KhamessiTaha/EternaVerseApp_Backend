// utils/warSystem.js
//
// Interstellar wars between civilizations. Wars start on their own (two
// living civs, aggression-weighted chance), grind both sides down each
// simulation step, and end either by attrition (a winner emerges from the
// accumulated war score) or by the PLAYER: arming a side tips the score
// (contactSystem 'arm'), brokering peace ends it outright ('broker').
// Pure functions over the universe document; physicsEngine ticks this once
// per simulation step and records the returned events.
const { civDesignation } = require("./contactSystem");

const MAX_CONCURRENT_WARS = 2;
const WAR_START_BASE_PROB = 0.0012; // per step, scaled by combined aggression
const WAR_END_PROB = 0.012;         // per step (~8 in-game "hours" of steps on average)

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Tick all war logic for one simulation step. Mutates the universe;
 * returns an array of { description, effects } events to record.
 */
function tickWars(universe, rand = Math.random) {
  if (!Array.isArray(universe.activeWars)) universe.activeWars = [];
  const events = [];
  const alive = (universe.civilizations || []).filter((c) => !c.extinct);
  const byId = Object.fromEntries(alive.map((c) => [c.id, c]));

  // --- Progress existing wars ---
  for (let i = universe.activeWars.length - 1; i >= 0; i--) {
    const war = universe.activeWars[i];
    const a = byId[war.a];
    const b = byId[war.b];

    // A side went extinct (war or otherwise): war ends by annihilation
    if (!a || !b) {
      const survivor = a || b;
      universe.activeWars.splice(i, 1);
      if (survivor) {
        survivor.stability = clamp((survivor.stability ?? 0.5) + 0.05, 0, 1);
        events.push({
          description: `The war is over: ${civDesignation(survivor.id)} stands alone among the ashes of their enemy.`,
          effects: { warId: war.id, outcome: "annihilation", survivor: survivor.id },
        });
      }
      continue;
    }

    // Attrition: both sides bleed while the war runs
    for (const civ of [a, b]) {
      civ.stability = clamp((civ.stability ?? 0.5) - 0.004, 0, 1);
      civ.population = Math.max(1e4, Math.floor((civ.population || 1e6) * 0.997));
      civ.technology = clamp((civ.technology || 0) + 0.05, 0, 100); // war R&D
    }

    // War score accumulates from tech + aggression (+ player arms)
    war.scoreA = (war.scoreA || 0) + ((a.technology || 0) * 0.1 + (a.warlikeness || 0) * 5) * rand();
    war.scoreB = (war.scoreB || 0) + ((b.technology || 0) * 0.1 + (b.warlikeness || 0) * 5) * rand();

    if (rand() < WAR_END_PROB) {
      universe.activeWars.splice(i, 1);
      const [winner, loser] = war.scoreA >= war.scoreB ? [a, b] : [b, a];
      winner.stability = clamp((winner.stability ?? 0.5) + 0.1, 0, 1);
      winner.technology = clamp((winner.technology || 0) + 3, 0, 100);
      loser.stability = clamp((loser.stability ?? 0.5) - 0.15, 0, 1);
      loser.population = Math.max(1e4, Math.floor((loser.population || 1e6) * 0.6));
      events.push({
        description: `The war between ${civDesignation(a.id)} and ${civDesignation(b.id)} ends: ${civDesignation(winner.id)} claims victory.`,
        effects: { warId: war.id, outcome: "victory", winner: winner.id, loser: loser.id },
      });
    }
  }

  // --- Maybe start a new war ---
  if (universe.activeWars.length < MAX_CONCURRENT_WARS && alive.length >= 2) {
    const a = alive[Math.floor(rand() * alive.length)];
    const others = alive.filter((c) => c.id !== a.id);
    const b = others[Math.floor(rand() * others.length)];
    const heat = ((a.warlikeness || 0) + (b.warlikeness || 0)) / 2;

    if (rand() < WAR_START_BASE_PROB * (0.5 + heat * 2.5)) {
      universe.activeWars.push({
        id: `war_${Date.now()}_${Math.floor(rand() * 1e5)}`,
        a: a.id,
        b: b.id,
        scoreA: 0,
        scoreB: 0,
        startedAt: new Date(),
      });
      events.push({
        description: `War erupts between ${civDesignation(a.id)} and ${civDesignation(b.id)}. Both fleets are burning fuel toward the frontier.`,
        effects: { warId: universe.activeWars[universe.activeWars.length - 1].id, outcome: "outbreak", a: a.id, b: b.id },
      });
    }
  }

  return events;
}

/** The war (if any) that a given civ is currently fighting. */
function activeWarFor(universe, civId) {
  return (universe.activeWars || []).find((w) => w.a === civId || w.b === civId) || null;
}

module.exports = { tickWars, activeWarFor, MAX_CONCURRENT_WARS };
