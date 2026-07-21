# EternaVerse — Backend

Server-authoritative simulation engine for [EternaVerse](https://github.com/KhamessiTaha/EternaVerseApp), a browser-based universe simulation game. Express + MongoDB, deployed as a Vercel serverless function.

Every universe is a persistent document that keeps evolving between visits — driven by a scheduled sweep rather than a long-running server, to fit entirely on free-tier infrastructure.

## What it does

A universe starts at the Big Bang and advances in fixed 30-second steps: galaxies form, stars ignite, life emerges on habitable worlds, and civilizations rise through the Kardashev scale (Type 0 → Type III), each carrying its own temperament, tech level, resources, and relationship toward the player. Spacetime anomalies spawn continuously and must be resolved before they erode universe stability. Civilizations can go to war with each other; the player can arm a side, broker peace, uplift, pacify, or be worshipped.

None of this is trusted from the client. Every reward, cost, and probability roll is computed and validated server-side — the frontend only mirrors values for display. If the two diverge, that's a balance bug, not a security hole.

### Core systems (`utils/`)

| Module | Responsibility |
|---|---|
| `physicsEngine.js` | Per-step cosmological evolution: structure growth, civilization emergence/extinction, tech and population drift, resource depletion |
| `simulationRunner.js` | Converts elapsed wall-clock time into simulation steps (`advanceUniverse`), capped per request so a long-idle universe catches up gradually instead of stalling |
| `anomalyGenerator.js` | Spacetime anomaly spawning, severity, and resolution |
| `minorAnomalies.js` | Client-detected micro-anomalies, validated and deduplicated server-side against a per-universe resolved-ID set |
| `contactSystem.js` | Civilization attitude model, relationship shifts, and contact actions (observe / uplift / pacify / arm / broker peace) |
| `warSystem.js` | Inter-civilization war lifecycle: start probability, attrition, resolution, winner/loser effects |
| `missionSystem.js` | Procedural objective generation with escalating tiers so repeat missions scale in difficulty and reward instead of looping flat |
| `eventRewards.js` | Cooldown-gated rewards for live cosmic events (supernovae, comets, derelicts) |
| `achievements.js` | Achievement catalog and award-on-simulate evaluation |
| `hullCatalog.js` / `upgradeCatalog.js` | Ship hull and upgrade definitions, server-side loadout validation |
| `discoveryValidator.js` | Server-side validation of client-reported scan discoveries |
| `mlPredictor.js` | Stability-trend forecasting (heuristic scaffold; interface designed for a future TensorFlow.js model) |

### API (`routes/`)

- **`auth.js`** — register / login (JWT)
- **`universe.js`** — universe CRUD, simulate, resolve/contact/upgrade/mission/discovery endpoints, plus `requireAdmin`-gated dev routes for testing (fast-forward, grant research, spawn anomalies/civilizations/wars) — never exposed to non-admin accounts
- **`user.js`** — profile, achievements, loadout
- **`cron.js`** — the offline-progression sweep endpoint, authenticated by a shared secret rather than JWT since it's called by a scheduler, not a player

### Offline progression on a free tier

Vercel's free plan has no persistent process to run a simulation loop, so instead: a [GitHub Actions cron job](.github/workflows/simulation-sweep.yml) hits `/api/cron/sweep` on a schedule, which advances every active universe by however many steps its elapsed real time earns it. A universe also catches up opportunistically the moment its owner reopens it. Concurrent writes (a sweep landing mid-request) are handled as optimistic-concurrency conflicts — the loser reloads and returns a `concurrent: true` response rather than corrupting state.

## Stack

Node.js · Express 4 · Mongoose 8 (MongoDB) · JWT auth (bcrypt password hashing) · deployed on Vercel via `serverless-http`

## Getting started

```bash
npm install
cp .env.example .env   # fill in MONGO_URI, JWT_SECRET, CRON_SECRET
npm run dev             # local dev server (dev.js)
npm test                 # 50+ unit tests over the utils/ simulation modules
```

### Environment variables

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Signing secret for player auth tokens |
| `CRON_SECRET` | Shared secret the sweep scheduler presents to `/api/cron/sweep` |

## Testing

`npm test` runs `node --test` over `tests/*.test.js` — unit coverage for the upgrade catalog, contact system, mission system, achievements, hull catalog, minor-anomaly resolution, event rewards, and the war system, focused on the server-authoritative math a client could otherwise exploit.

## Related

- [EternaVerseApp](https://github.com/KhamessiTaha/EternaVerseApp) — the frontend (React + Phaser) this API serves
