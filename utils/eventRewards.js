// utils/eventRewards.js
//
// Rewards for live cosmic events (supernova capture, comet sampling,
// derelict salvage). The events themselves are client-side spectacle - the
// server can't verify a comet existed, so instead of trusting the client it
// RATE-LIMITS: one reward per event type per cooldown window, tracked on
// the universe. Farming is pointless by construction, and the stakes are
// single-player RP.

const EVENT_REWARDS = {
  supernova: { rp: 50, cooldownMs: 240000, title: "Captured spectral data from a dying star" },
  comet: { rp: 18, cooldownMs: 120000, title: "Sampled a comet's tail at close range" },
  derelict: { rp: 30, cooldownMs: 180000, title: "Salvaged a derelict vessel" },
};

function claimEventReward(universe, kind, now = Date.now()) {
  const spec = EVENT_REWARDS[kind];
  if (!spec) return { ok: false, reason: "Unknown event kind" };

  if (!universe.eventRewards) universe.eventRewards = {};
  // undefined = never claimed = always claimable (a 0/falsy default would
  // make claimability depend on wall-clock size - fine in prod, wrong logic)
  const last = universe.eventRewards[kind];
  if (last !== undefined && now - last < spec.cooldownMs) {
    return { ok: false, reason: "Event reward on cooldown", cooldown: true };
  }

  universe.eventRewards[kind] = now;

  if (!universe.research) universe.research = {};
  universe.research.points = (universe.research.points || 0) + spec.rp;
  universe.research.totalEarned = (universe.research.totalEarned || 0) + spec.rp;

  return { ok: true, reward: spec.rp, title: spec.title };
}

module.exports = { EVENT_REWARDS, claimEventReward };
