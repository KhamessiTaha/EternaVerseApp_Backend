/**
 * Single policy for the universe's significantEvents log, shared by the
 * physics engine and the API routes. Previously the two enforced different
 * caps (routes silently dropped new events once full; the engine spliced old
 * ones), which meant important events like universe_end could vanish.
 */

const MAX_EVENTS = 2000;

/**
 * Append an event, evicting the oldest entries to stay within MAX_EVENTS.
 * Timestamp and age fields are derived from the universe automatically.
 */
function recordEvent(universe, { type, description, effects = {} }) {
  if (!Array.isArray(universe.significantEvents)) {
    universe.significantEvents = [];
  }

  const events = universe.significantEvents;
  if (events.length >= MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS + 1);
  }

  const age = universe.currentState?.age ?? 0;
  events.push({
    timestamp: new Date(),
    age,
    type,
    description,
    effects,
    ageGyr: (age / 1e9).toFixed(3)
  });
}

module.exports = { recordEvent, MAX_EVENTS };
