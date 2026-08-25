// utils/seedCode.js
//
// A universe you can hand to someone else.
//
// The seed already decides everything a universe generates, but it was an
// unreadable `Math.random().toString(36)` string that never appeared in the
// UI - so no player could ever say "go and play the one I played".
//
// A share code is that seed, in a form a person can read out loud, type from a
// screenshot, or put in a message: KX7-2291.
//
// The important property: for every universe created from here on, THE CODE IS
// THE SEED. Not a hash of it, not a lookup key - the same string. So typing a
// friend's code generates the identical cosmos, with no shared database of
// codes and no way for the two to drift apart.
//
// Mirrored by the frontend's world/seedCode.js for display and input
// validation; this copy is what actually seeds a universe.

// No I, O, 0 or 1 anywhere in the letter block - those are the four characters
// people get wrong when copying a code off a screenshot.
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}-\d{4}$/;

/** Is this already a canonical share code? */
function isShareCode(value) {
  return typeof value === "string" && CODE_RE.test(value);
}

/**
 * Coerce player input into a canonical code, or null if it can't be one.
 * Forgiving about the things people actually get wrong: case, spaces, and a
 * missing or doubled dash.
 */
function normalizeCode(input) {
  if (typeof input !== "string") return null;
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== 7) return null;

  const letters = cleaned.slice(0, 3);
  const digits = cleaned.slice(3);
  if (!/^\d{4}$/.test(digits)) return null;
  if (![...letters].every((c) => ALPHA.includes(c))) return null;

  return `${letters}-${digits}`;
}

/** A fresh code. This becomes the universe's seed verbatim. */
function generateCode(rng = Math.random) {
  let letters = "";
  for (let i = 0; i < 3; i++) letters += ALPHA[Math.floor(rng() * ALPHA.length)];
  const digits = String(Math.floor(rng() * 10000)).padStart(4, "0");
  return `${letters}-${digits}`;
}

/**
 * The code to SHOW for a universe.
 *
 * Universes seeded from a code return it unchanged - those are perfectly
 * shareable. Universes created before share codes existed have long random
 * seeds that can't be squeezed into seven characters, so they get a stable
 * derived code for display; `reproducible` says which is which, because
 * telling a player to share a code that won't rebuild their universe would be
 * worse than telling them nothing.
 */
function codeForSeed(seed) {
  if (isShareCode(seed)) return { code: seed, reproducible: true };

  const s = String(seed ?? "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = Math.abs(h);

  let letters = "";
  let n = h;
  for (let i = 0; i < 3; i++) {
    letters += ALPHA[n % ALPHA.length];
    n = Math.floor(n / ALPHA.length);
  }
  const digits = String(h % 10000).padStart(4, "0");
  return { code: `${letters}-${digits}`, reproducible: false };
}

/** The seed a code produces. Identity by design. */
function seedForCode(code) {
  const norm = normalizeCode(code);
  return norm; // null when the input isn't a valid code
}

module.exports = { ALPHA, isShareCode, normalizeCode, generateCode, codeForSeed, seedForCode };
