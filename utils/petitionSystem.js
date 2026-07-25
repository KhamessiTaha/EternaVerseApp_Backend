// utils/petitionSystem.js
//
// Civilization petitions: the civs stop being things you act UPON and start
// acting on YOU. A civ you've met can broadcast a request - beg for weapons in
// a losing war, plead for rescue as its biosphere fails, offer tribute, trade
// knowledge, or issue an ultimatum - and wait (a bounded number of steps) for
// your answer. Each option applies a real, server-validated outcome; ignoring
// a petition resolves it the hard way.
//
// Server-authoritative like everything else: generation and resolution both
// live here, the client only renders the petition and posts the chosen option.

const { civDesignation, civAttitude, applyContact } = require("./contactSystem");

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const shift = (civ, d) => { civ.relationship = clamp((civ.relationship || 0) + d, -1, 1); };
const grantRP = (universe, amount) => {
  if (!universe.research) universe.research = {};
  universe.research.points = (universe.research.points || 0) + amount;
  universe.research.totalEarned = (universe.research.totalEarned || 0) + amount;
};

const MAX_ACTIVE_PETITIONS = 2;   // never flood the player
const PETITION_DEADLINE_STEPS = 24;
const BASE_PETITION_CHANCE = 0.05; // per eligible civ per step

const TRIBUTE_BY_TYPE = { Type0: 15, Type1: 30, Type2: 60, Type3: 110 };

/**
 * A civ's disposition, assigned once from its innate stats. Flavors which
 * petitions it raises and how it phrases them.
 */
function derivePersonality(civ, rand = Math.random) {
  const w = civ.warlikeness ?? 0;
  if (w > 0.62) return "militant";
  if ((civ.technology ?? 0) > 58 && (civ.type === "Type2" || civ.type === "Type3")) return "scholarly";
  if (civ.type === "Type0" || civ.type === "Type1") return rand() < 0.5 ? "devout" : "insular";
  return rand() < 0.5 ? "mercantile" : "insular";
}

function warFor(universe, civId) {
  return (universe.activeWars || []).find((w) => w.a === civId || w.b === civId) || null;
}

/**
 * Build a petition for a civ from its current state, or null if it has
 * nothing to ask right now. Priority: existential crisis > war > threat >
 * tribute/knowledge.
 */
function buildPetition(universe, civ, stepIndex, rand = Math.random) {
  const name = civDesignation(civ.id);
  const attitude = civAttitude(civ);
  const id = `${civ.id}:${stepIndex}:${Math.floor(rand() * 1e6)}`;
  const base = { id, createdStep: stepIndex, deadline: PETITION_DEADLINE_STEPS, civName: name, personality: civ.personality };

  const dying = (civ.resourceDepletion ?? 0) > 0.72 || (civ.stability ?? 0.5) < 0.28;
  if (dying) {
    return {
      ...base,
      kind: "crisis",
      text: `${name} broadcasts a distress call on every band: their world is dying — resources spent, biosphere collapsing. They beg the sky-vessel to reach down and save them.`,
      options: [
        { id: "intervene", label: "Intervene — stabilize their world (120 RP)", cost: 120 },
        { id: "refuse", label: "Let nature take its course" },
      ],
    };
  }

  const war = warFor(universe, civ.id);
  if (war && (civ.warlikeness ?? 0) > 0.25) {
    const enemyId = war.a === civ.id ? war.b : war.a;
    const enemyName = civDesignation(enemyId);
    return {
      ...base,
      kind: "aid",
      enemyId,
      text: `${name} is losing its war with ${enemyName}. They plead for weapons and swear a moon will be named for you if you tip the scales.`,
      options: [
        { id: "arm", label: "Arm them (80 RP)", cost: 80 },
        { id: "broker", label: "Broker peace (120 RP)", cost: 120 },
        { id: "refuse", label: "Stay out of their war" },
      ],
    };
  }

  if (attitude === "hostile" && rand() < 0.6) {
    return {
      ...base,
      kind: "threat",
      text: `${name} issues an ultimatum: withdraw the sky-vessel from their skies, or they will treat it as an enemy of their people.`,
      options: [
        { id: "appease", label: "Send a gesture of peace (40 RP)", cost: 40 },
        { id: "defy", label: "Ignore the ultimatum" },
      ],
    };
  }

  if (attitude === "worship" || attitude === "friendly") {
    return {
      ...base,
      kind: "tribute",
      text: `${name} has raised a temple to the sky-vessel and lays tribute before it, asking only for a sign of your favor.`,
      options: [
        { id: "accept", label: "Accept their tribute" },
        { id: "bless", label: "Bless them — send a sign (60 RP)", cost: 60 },
        { id: "ignore", label: "Remain silent" },
      ],
    };
  }

  if (civ.type !== "Type0" && (civ.uplifts || 0) < 3) {
    return {
      ...base,
      kind: "knowledge",
      text: `${name} opens a channel: they offer their accumulated star-charts and research in exchange for a technological uplift.`,
      options: [
        { id: "trade", label: "Trade an uplift for their knowledge" },
        { id: "decline", label: "Decline the exchange" },
      ],
    };
  }

  return null;
}

/**
 * Once per step (called from the sim loop): assign personalities, and let a
 * few eligible civs raise a petition. Returns the newly created petitions so
 * the runner can log a significant event for each.
 */
function generatePetitions(universe, stepIndex, rand = Math.random) {
  const civs = universe.civilizations || [];
  let active = civs.filter((c) => c.petition).length;
  const created = [];

  for (const civ of civs) {
    if (civ.extinct) continue;
    if (!civ.personality) civ.personality = derivePersonality(civ, rand);
    if (active >= MAX_ACTIVE_PETITIONS) continue;
    if (civ.petition) continue;
    if (civ.location?.x == null) continue;            // must be locatable to appear
    if (!civ.observed && (civ.relationship || 0) === 0) continue; // must know the player
    if (rand() >= BASE_PETITION_CHANCE) continue;

    const petition = buildPetition(universe, civ, stepIndex, rand);
    if (!petition) continue;
    civ.petition = petition;
    active++;
    created.push({ civId: civ.id, petition });
  }
  return created;
}

// The outcome applied for a chosen (or defaulted) option. Returns a message.
function applyOption(universe, civ, petition, optionId, rand = Math.random) {
  const name = civDesignation(civ.id);

  switch (petition.kind) {
    case "crisis": {
      if (optionId === "intervene") {
        if ((universe.research?.points || 0) < 120) return { ok: false, reason: "Insufficient research (120 RP)" };
        universe.research.points -= 120;
        civ.resourceDepletion = clamp((civ.resourceDepletion ?? 0) - 0.55, 0, 1);
        civ.stability = clamp((civ.stability ?? 0.5) + 0.28, 0, 1);
        civ.population = Math.max(1e5, Math.floor((civ.population || 1e6) * 1.05));
        shift(civ, 0.28);
        return { ok: true, message: `You stayed the collapse of ${name}. They will not forget who reached down.` };
      }
      // refused / ignored: they suffer, and remember the silence
      civ.stability = clamp((civ.stability ?? 0.5) - 0.12, 0, 1);
      shift(civ, -0.15);
      return { ok: true, message: `You let ${name} face its collapse alone.` };
    }

    case "aid": {
      if (optionId === "arm" || optionId === "broker") {
        const res = applyContact(universe, civ.id, optionId, rand);
        if (!res.ok) return { ok: false, reason: res.reason };
        return { ok: true, message: res.message };
      }
      shift(civ, -0.1);
      return { ok: true, message: `You stayed out of ${name}'s war. They fight on without you.` };
    }

    case "threat": {
      if (optionId === "appease") {
        if ((universe.research?.points || 0) < 40) return { ok: false, reason: "Insufficient research (40 RP)" };
        universe.research.points -= 40;
        civ.warlikeness = clamp((civ.warlikeness || 0) - 0.06, 0, 1);
        shift(civ, 0.16);
        return { ok: true, message: `Your gesture cooled ${name}'s fury, for now.` };
      }
      civ.warlikeness = clamp((civ.warlikeness || 0) + 0.06, 0, 1);
      shift(civ, -0.1);
      return { ok: true, message: `You ignored ${name}'s ultimatum. Their military spending doubles.` };
    }

    case "tribute": {
      if (optionId === "bless") {
        if ((universe.research?.points || 0) < 60) return { ok: false, reason: "Insufficient research (60 RP)" };
        universe.research.points -= 60;
        civ.stability = clamp((civ.stability ?? 0.5) + 0.1, 0, 1);
        shift(civ, 0.2);
        return { ok: true, message: `You sent a sign. ${name} erupts in celebration; your legend grows.` };
      }
      if (optionId === "accept") {
        const tribute = TRIBUTE_BY_TYPE[civ.type] ?? 15;
        grantRP(universe, tribute);
        shift(civ, 0.06);
        return { ok: true, message: `You accept the tribute of ${name} (+${tribute} RP).` };
      }
      shift(civ, -0.05);
      return { ok: true, message: `The sky-vessel stays silent. ${name}'s priests counsel patience.` };
    }

    case "knowledge": {
      if (optionId === "trade") {
        civ.technology = clamp((civ.technology || 0) + 7 + rand() * 5, 0, 100);
        civ.developmentLevel = clamp((civ.developmentLevel || 0) + 0.05, 0, 1);
        civ.uplifts = (civ.uplifts || 0) + 1;
        const reward = 40 + Math.floor(rand() * 25);
        grantRP(universe, reward);
        shift(civ, 0.12);
        return { ok: true, message: `${name} shares its star-charts (+${reward} RP); you accelerate their science in return.` };
      }
      shift(civ, -0.05);
      return { ok: true, message: `You decline ${name}'s exchange. The channel closes.` };
    }

    default:
      return { ok: false, reason: "Unknown petition" };
  }
}

/**
 * Player response to a petition (POST contact action). Validates the petition
 * is the live one on that civ, applies the option, and clears the petition.
 */
function respondToPetition(universe, civId, petitionId, optionId, rand = Math.random) {
  const civ = (universe.civilizations || []).find((c) => c.id === civId);
  if (!civ) return { ok: false, reason: "Civilization not found" };
  if (!civ.petition || civ.petition.id !== petitionId) {
    return { ok: false, reason: "This petition has expired" };
  }
  const petition = civ.petition;
  const valid = (petition.options || []).some((o) => o.id === optionId);
  if (!valid) return { ok: false, reason: "Invalid response" };

  const res = applyOption(universe, civ, petition, optionId, rand);
  if (!res.ok) return res; // e.g. insufficient RP - leave the petition standing

  civ.petition = null;
  return { ok: true, action: "respond-petition", kind: petition.kind, optionId, civ, message: res.message };
}

/**
 * Once per step: petitions the player never answered resolve the hard way
 * (their default/refused branch). Returns events for the log.
 */
function expirePetitions(universe, stepIndex, rand = Math.random) {
  const events = [];
  for (const civ of universe.civilizations || []) {
    const p = civ.petition;
    if (!p) continue;
    if (stepIndex - (p.createdStep || 0) < (p.deadline || PETITION_DEADLINE_STEPS)) continue;

    // Default = the last option (always the refuse/ignore branch by construction)
    const fallback = p.options[p.options.length - 1].id;
    const res = applyOption(universe, civ, p, fallback, rand);
    civ.petition = null;
    events.push({ civId: civ.id, description: `${p.civName}'s petition went unanswered. ${res.message || ""}`.trim() });
  }
  return events;
}

module.exports = {
  derivePersonality,
  generatePetitions,
  respondToPetition,
  expirePetitions,
  MAX_ACTIVE_PETITIONS,
  PETITION_DEADLINE_STEPS,
  BASE_PETITION_CHANCE,
};
