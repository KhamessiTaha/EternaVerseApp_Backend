# EternaVerse — Backend

**Server-authoritative simulation engine** for [EternaVerse](https://github.com/KhamessiTaha/EternaVerseApp), a browser-based universe simulation game. Every universe is a persistent, continuously evolving world — advanced by a scheduled sweep rather than an always-on server, so it runs entirely on free-tier infrastructure.

> 🔒 **Proprietary — commercial project in active development.** This repository is published for portfolio and demonstration purposes. The source is **not** open for reuse, redistribution, or self-hosting. See [copyright](#copyright).

---

## What it does

A universe starts at the Big Bang and advances in fixed time steps: galaxies form, stars ignite, life emerges on habitable worlds, and civilizations rise through the Kardashev scale (Type 0 → Type III), each carrying its own temperament, tech level, resources, and relationship toward the player. Spacetime anomalies spawn continuously and erode stability until resolved. Civilizations wage war on each other; the player can arm a side, broker peace, uplift, pacify, or be worshipped.

## Engineering notes

The parts a technical reviewer might find interesting:

- **Nothing is trusted from the client.** Every reward, cost, and probability roll is computed and validated server-side — the game client only mirrors values for display. A tampered client can't grant itself anything that persists.
- **Time-based simulation without an always-on process.** Elapsed real time is converted into a bounded number of simulation steps per request, so a long-idle universe catches up gradually instead of stalling or spiking. A scheduled job sweeps all active universes; a universe also advances opportunistically the moment its owner returns.
- **Concurrency-safe writes.** When a scheduled sweep lands mid-request, the conflict is resolved with optimistic concurrency — the loser reloads and reports the collision rather than corrupting shared state.
- **Deep, testable game systems.** Cosmological evolution, a civilization attitude/diplomacy model, an inter-civilization war lifecycle, escalating procedural objectives, cooldown-gated live-event rewards, and an achievement engine — the exploitable math is covered by a unit-test suite.
- **Admin-gated tooling.** Development/testing endpoints (fast-forward, spawn entities, etc.) are locked behind a database-backed admin check and never reachable by ordinary accounts.

## Tech stack

Node.js · Express · Mongoose (MongoDB) · JWT auth (bcrypt) · deployed on Vercel as a serverless function

Consumed by the game client: **[EternaVerseApp](https://github.com/KhamessiTaha/EternaVerseApp)** (React · Phaser · Three.js).

## Copyright

© 2026 Taha Khamessi. All rights reserved.

This project and its source code are proprietary. No permission is granted to use, copy, modify, distribute, or self-host any part of this repository. It is shared publicly solely to demonstrate the author's work. For inquiries: **khamessi.taha@gmail.com**.
