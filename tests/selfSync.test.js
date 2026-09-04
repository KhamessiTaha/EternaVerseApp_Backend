// tests/selfSync.test.js
//
// This is the file standing between a merge bug and real players losing
// identity progress they cannot get back. Weighted accordingly.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  defaults, normalize, mergeSelf, isFurtherAlong, progressRank, SCHEMA_VERSION,
} = require("../utils/selfSync");

const self = (over = {}) => ({ ...defaults(), ...over });

// --- the core safety property -------------------------------------------

test("merging never loses a recovered memory, insight or identity", () => {
  const deviceA = self({
    memoriesRecovered: ["m1", "m2"],
    insightsCompleted: ["i1"],
    identitiesRealized: ["observer"],
  });
  const deviceB = self({
    memoriesRecovered: ["m3"],
    insightsCompleted: ["i2"],
    identitiesRealized: ["gardener"],
  });

  const merged = mergeSelf(deviceA, deviceB);
  assert.deepEqual(merged.memoriesRecovered.sort(), ["m1", "m2", "m3"]);
  assert.deepEqual(merged.insightsCompleted.sort(), ["i1", "i2"]);
  assert.deepEqual(merged.identitiesRealized.sort(), ["gardener", "observer"]);
});

test("cumulative fields merge the same in either direction", () => {
  const a = self({ ascensions: 3, memoriesRecovered: ["m1"], anamnesisSeen: true });
  const b = self({ ascensions: 7, memoriesRecovered: ["m2"], anamnesisSeen: false });

  const ab = mergeSelf(a, b);
  const ba = mergeSelf(b, a);
  assert.equal(ab.ascensions, 7);
  assert.equal(ba.ascensions, 7);
  assert.equal(ab.anamnesisSeen, true, "a capstone once seen is seen forever");
  assert.equal(ba.anamnesisSeen, true);
  assert.deepEqual(ab.memoriesRecovered.sort(), ba.memoriesRecovered.sort());
});

test("no duplicates survive a union", () => {
  const a = self({ memoriesRecovered: ["m1", "m2"] });
  const b = self({ memoriesRecovered: ["m2", "m3"] });
  assert.deepEqual(mergeSelf(a, b).memoriesRecovered, ["m1", "m2", "m3"]);
});

// --- the interdependence that would re-award memories --------------------

test("cycle state moves as ONE unit - never mixed between devices", () => {
  // The bug this prevents: recoverOwed() computes
  // bandsPassed(recollection) - bandPointer. A high recollection from one
  // device with a low bandPointer from another re-awards Memories the player
  // has already read.
  const behind = self({
    recollection: 10, bandPointer: 1, memoriesRecovered: ["m1"],
    affinity: { observer: 10, gardener: 0, wanderer: 0, unmaker: 0 },
  });
  const ahead = self({
    recollection: 90, bandPointer: 5, memoriesRecovered: ["m1", "m2", "m3", "m4", "m5"],
    affinity: { observer: 40, gardener: 50, wanderer: 0, unmaker: 0 },
  });

  const merged = mergeSelf(behind, ahead);
  assert.equal(merged.recollection, 90);
  assert.equal(merged.bandPointer, 5, "must come from the SAME record as recollection");
  assert.equal(merged.affinity.gardener, 50, "and so must affinity");
});

test("the further-along record wins the cycle, whichever side it arrives on", () => {
  const behind = self({ recollection: 5, bandPointer: 0, memoriesRecovered: [] });
  const ahead = self({ recollection: 60, bandPointer: 4, memoriesRecovered: ["a", "b", "c", "d"] });

  for (const merged of [mergeSelf(behind, ahead), mergeSelf(ahead, behind)]) {
    assert.equal(merged.recollection, 60);
    assert.equal(merged.bandPointer, 4);
  }
});

test("identities outrank memories, which outrank raw recollection", () => {
  // Recollection resets to zero on every Revelation, so it is the WEAKEST
  // signal of progress - a player who just realized a Self has 0.
  const justRevealed = self({
    identitiesRealized: ["observer", "gardener"], recollection: 0, bandPointer: 0,
    memoriesRecovered: ["m1", "m2"],
  });
  const grinding = self({
    identitiesRealized: [], recollection: 120, bandPointer: 5,
    memoriesRecovered: ["m3", "m4", "m5", "m6", "m7", "m8"],
  });

  assert.ok(isFurtherAlong(justRevealed, grinding));
  const merged = mergeSelf(grinding, justRevealed);
  assert.equal(merged.recollection, 0, "the revelation's fresh cycle survives");
  assert.equal(merged.bandPointer, 0);
  assert.equal(merged.memoriesRecovered.length, 8, "but no memory is lost");
});

test("progressRank orders by identities, then memories, then recollection", () => {
  assert.deepEqual(progressRank(self({
    identitiesRealized: ["a"], memoriesRecovered: ["m"], recollection: 7,
  })), [1, 1, 7]);
});

test("identical records leave the incumbent alone", () => {
  const a = self({ recollection: 40, bandPointer: 2, memoriesRecovered: ["m1", "m2"] });
  assert.equal(isFurtherAlong(a, { ...a }), false);
});

// --- first sync and junk -------------------------------------------------

test("a first sync against nothing keeps everything the client sent", () => {
  const local = self({
    ascensions: 4, recollection: 33, bandPointer: 2,
    memoriesRecovered: ["m1", "m2"], identitiesRealized: ["wanderer"],
  });
  const merged = mergeSelf(null, local);
  assert.equal(merged.ascensions, 4);
  assert.equal(merged.recollection, 33);
  assert.deepEqual(merged.identitiesRealized, ["wanderer"]);
});

test("an empty client never erases what the server already holds", () => {
  // The dangerous direction: a fresh device syncing up must not wipe an
  // established account.
  const server = self({
    ascensions: 9, recollection: 88, bandPointer: 4,
    memoriesRecovered: ["m1", "m2", "m3"], identitiesRealized: ["observer", "unmaker"],
    anamnesisSeen: true,
  });
  const merged = mergeSelf(server, defaults());
  assert.equal(merged.ascensions, 9);
  assert.equal(merged.recollection, 88);
  assert.equal(merged.bandPointer, 4);
  assert.deepEqual(merged.identitiesRealized, ["observer", "unmaker"]);
  assert.equal(merged.anamnesisSeen, true);
});

test("merging is idempotent - running it twice changes nothing", () => {
  const a = self({ ascensions: 2, recollection: 30, bandPointer: 2, memoriesRecovered: ["m1"] });
  const b = self({ ascensions: 5, memoriesRecovered: ["m2"] });
  const once = mergeSelf(a, b);
  const twice = mergeSelf(once, b);
  assert.equal(twice.ascensions, once.ascensions);
  assert.deepEqual(twice.memoriesRecovered, once.memoriesRecovered);
  assert.equal(twice.recollection, once.recollection);
  assert.equal(twice.bandPointer, once.bandPointer);
});

test("junk is dropped rather than thrown", () => {
  const merged = mergeSelf(
    { ascensions: "nonsense", memoriesRecovered: [1, 2, { x: 1 }, "m1"], affinity: null },
    { recollection: NaN, bandPointer: -5, identitiesRealized: "not an array" }
  );
  assert.equal(merged.ascensions, 0);
  assert.deepEqual(merged.memoriesRecovered, ["m1"], "non-strings dropped");
  assert.equal(merged.recollection, 0);
  assert.equal(merged.bandPointer, 0, "negatives clamped");
  assert.deepEqual(merged.identitiesRealized, []);
  assert.equal(merged.schemaVersion, SCHEMA_VERSION);
});

test("normalize always yields a complete, usable Self", () => {
  for (const junk of [null, undefined, 42, "x", [], {}]) {
    const n = normalize(junk);
    assert.equal(typeof n.ascensions, "number");
    assert.ok(Array.isArray(n.memoriesRecovered));
    assert.deepEqual(Object.keys(n.affinity).sort(), ["gardener", "observer", "unmaker", "wanderer"]);
  }
});

// --- the extras that came along ------------------------------------------

test("personal bests take the better of the two per minigame", () => {
  const a = self({ bests: { "GravityWellScene:3": 88, "CascadeReactionScene:1": 70 } });
  const b = self({ bests: { "GravityWellScene:3": 94, "PolarityBalanceScene:5": 61 } });
  const merged = mergeSelf(a, b);
  assert.equal(merged.bests["GravityWellScene:3"], 94);
  assert.equal(merged.bests["CascadeReactionScene:1"], 70);
  assert.equal(merged.bests["PolarityBalanceScene:5"], 61);
});

test("curator rapport and asked prompts are never lost", () => {
  const a = self({ rapport: 12, asked: ["q1"] });
  const b = self({ rapport: 5, asked: ["q2"] });
  const merged = mergeSelf(a, b);
  assert.equal(merged.rapport, 12);
  assert.deepEqual(merged.asked.sort(), ["q1", "q2"]);
});

test("a merge stamps when it happened", () => {
  const when = new Date("2026-02-02T00:00:00Z");
  assert.equal(mergeSelf(null, defaults(), when).updatedAt, when);
});

// --- classify certification ----------------------------------------------

test("certification survives a device switch", () => {
  const a = { ascensions: 0, classify: { elliptical: { calls: 14, correct: 13 } } };
  const merged = mergeSelf(a, { ascensions: 0 }, new Date());
  assert.deepEqual(merged.classify.elliptical, { calls: 14, correct: 13 });
});

test("merging takes the further-along record, NOT the sum", () => {
  // Summing would double-count what both devices already agree on: sync down,
  // scan twelve, sync up, and the merge would read twenty-four - certifying a
  // player who never earned it.
  const a = { ascensions: 0, classify: { spiral: { calls: 12, correct: 11 } } };
  const b = { ascensions: 0, classify: { spiral: { calls: 8, correct: 7 } } };
  assert.deepEqual(mergeSelf(a, b, new Date()).classify.spiral, { calls: 12, correct: 11 });
  assert.deepEqual(mergeSelf(b, a, new Date()).classify.spiral, { calls: 12, correct: 11 },
    "and it is order-independent");
});

test("families merge independently", () => {
  const a = { ascensions: 0, classify: { spiral: { calls: 20, correct: 19 } } };
  const b = { ascensions: 0, classify: { barred: { calls: 15, correct: 14 } } };
  const m = mergeSelf(a, b, new Date());
  assert.equal(m.classify.spiral.calls, 20);
  assert.equal(m.classify.barred.calls, 15);
});

test("a client cannot certify itself by claiming more correct than calls", () => {
  const cheat = { ascensions: 0, classify: { spiral: { calls: 2, correct: 999 } } };
  const m = mergeSelf(cheat, null, new Date());
  assert.equal(m.classify.spiral.correct, 2, "correct is clamped to calls");
});

test("junk classify data never reaches the record", () => {
  for (const junk of [null, "nonsense", 42, { spiral: "no" }, { spiral: { calls: -5 } }]) {
    const m = mergeSelf({ ascensions: 0, classify: junk }, null, new Date());
    assert.equal(typeof m.classify, "object");
    for (const v of Object.values(m.classify)) {
      assert.ok(Number.isFinite(v.calls) && v.calls > 0);
      assert.ok(v.correct <= v.calls);
    }
  }
});
