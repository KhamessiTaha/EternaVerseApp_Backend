// tests/artifacts.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ARTIFACTS, ARTIFACT_IDS, MAX_PER_UNIVERSE, MAX_NOTE,
  canBuild, placeArtifact, recordWork,
} = require("../utils/artifacts");
const { MATERIAL_IDS } = require("../utils/materials");

const stocked = () => ({
  iron: 50, carbon: 50, oxygen: 50, gold: 10, uranium: 5,
});

const uni = (over = {}) => ({
  _id: { toString: () => "uni_1" },
  name: "First Light",
  materials: stocked(),
  artifacts: [],
  ...over,
});

test("every artifact costs matter that actually exists", () => {
  for (const id of ARTIFACT_IDS) {
    const a = ARTIFACTS[id];
    assert.ok(a.label, id);
    assert.ok(Object.keys(a.cost).length > 0, `${id} is free`);
    for (const mat of Object.keys(a.cost)) {
      assert.ok(MATERIAL_IDS.includes(mat), `${id} asks for unknown material ${mat}`);
    }
  }
});

test("placing one spends the matter and puts it in the world", () => {
  const u = uni();
  const res = placeArtifact(u, { kind: "beacon", x: 120, y: -80 });

  assert.equal(res.ok, true);
  assert.equal(u.artifacts.length, 1);
  assert.equal(u.artifacts[0].kind, "beacon");
  assert.equal(u.artifacts[0].x, 120);
  assert.equal(u.materials.iron, 50 - ARTIFACTS.beacon.cost.iron);
  assert.equal(u.materials.carbon, 50 - ARTIFACTS.beacon.cost.carbon);
});

test("a monument is gated behind the r-process", () => {
  // Gold only comes from a neutron-star merger, so a monument is expensive in
  // a way the universe itself has to earn.
  assert.ok(ARTIFACTS.monument.cost.gold > 0);
  const poor = uni({ materials: { iron: 99, carbon: 99 } });
  const res = placeArtifact(poor, { kind: "monument", x: 0, y: 0 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /gold/i);
  assert.equal(poor.artifacts.length, 0, "nothing was placed");
});

test("a failed placement spends nothing", () => {
  const u = uni({ materials: { iron: 1 } });
  const before = { ...u.materials };
  placeArtifact(u, { kind: "beacon", x: 0, y: 0 });
  assert.deepEqual(u.materials, before);
});

test("an artifact remembers the scale it was planted at", () => {
  // Cosmic Scales: a beacon planted inside a star system must not render out
  // at the galactic scale, or it points at nothing.
  const u = uni();
  const res = placeArtifact(u, {
    kind: "beacon", x: 5, y: 5, scale: "planetary", path: ["gal_1", "star_2"],
  });
  assert.equal(res.artifact.scale, "planetary");
  assert.deepEqual(res.artifact.path, ["gal_1", "star_2"]);
});

test("placement needs a real place", () => {
  const u = uni();
  for (const bad of [{}, { x: 1 }, { x: NaN, y: 0 }, { x: "here", y: 0 }]) {
    const res = placeArtifact(u, { kind: "beacon", ...bad });
    assert.equal(res.ok, false, JSON.stringify(bad));
  }
  assert.equal(u.artifacts.length, 0);
});

test("a universe is a place, not a warehouse", () => {
  // An artifact that is everywhere means nothing anywhere.
  const u = uni({ materials: { iron: 9999, carbon: 9999 } });
  for (let i = 0; i < MAX_PER_UNIVERSE; i++) {
    assert.equal(placeArtifact(u, { kind: "beacon", x: i, y: 0 }).ok, true, `#${i}`);
  }
  const overflow = placeArtifact(u, { kind: "beacon", x: 999, y: 0 });
  assert.equal(overflow.ok, false);
  assert.match(overflow.reason, /already holds/i);
});

test("notes are kept but bounded", () => {
  const u = uni();
  const res = placeArtifact(u, { kind: "beacon", x: 0, y: 0, note: "x".repeat(500) });
  assert.equal(res.artifact.note.length, MAX_NOTE);
});

test("unknown artifacts are refused", () => {
  const u = uni();
  assert.equal(placeArtifact(u, { kind: "deathstar", x: 0, y: 0 }).ok, false);
  assert.equal(canBuild(stocked(), "deathstar").ok, false);
});

// --- the account-wide copy ----------------------------------------------

test("a work is copied to the account, so it outlives the universe", () => {
  const u = uni();
  const { artifact } = placeArtifact(u, { kind: "monument", x: 3, y: 4, note: "here they fell" });
  const { works, added } = recordWork([], artifact, u);

  assert.equal(works.length, 1);
  assert.equal(added.kind, "monument");
  assert.equal(added.note, "here they fell");
  // Where it stood travels with it - that's what makes the echo land later.
  assert.equal(added.universeId, "uni_1");
  assert.equal(added.universeName, "First Light");
});

test("recording the same work twice changes nothing", () => {
  const u = uni();
  const { artifact } = placeArtifact(u, { kind: "beacon", x: 0, y: 0 });
  const first = recordWork([], artifact, u);
  const second = recordWork(first.works, artifact, u);

  assert.equal(second.added, null);
  assert.equal(second.works, first.works, "unchanged means the same array");
});
