// routes/cron.js
//
// Machine-facing endpoints, called by an external scheduler (GitHub Actions,
// cron-job.org, ...) - NOT by game clients. Authenticated with a shared
// secret (CRON_SECRET env var) instead of a user JWT, and mounted outside
// the verifyToken middleware that guards the player routes.
const express = require("express");
const router = express.Router();
const Universe = require("../models/Universe");
const { advanceUniverse } = require("../utils/simulationRunner");

// Universes swept per invocation - most-starved first, so with more
// universes than this cap every one still gets advanced across consecutive
// sweeps rather than the same batch hogging every run.
const MAX_UNIVERSES_PER_SWEEP = 100;

router.post("/sweep", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  // 404 (not 401) so the endpoint doesn't advertise its existence to probes.
  // A missing CRON_SECRET config also refuses everything rather than
  // becoming an open door.
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }

  try {
    const universes = await Universe.find({ status: "running" })
      .sort({ lastSimulatedAt: 1 })
      .limit(MAX_UNIVERSES_PER_SWEEP);

    const now = new Date();
    let advanced = 0;
    let ended = 0;
    let totalSteps = 0;
    const failures = [];

    for (const uni of universes) {
      try {
        const result = advanceUniverse(uni, now);
        if (result.steps > 0) {
          await uni.save();
          advanced++;
          totalSteps += result.steps;
          if (uni.status === "ended") ended++;
        }
      } catch (err) {
        // One broken universe must not stall the rest of the sweep
        console.error(`Sweep failed for universe ${uni._id}:`, err.message);
        failures.push(uni._id.toString());
      }
    }

    console.log(`🕘 Sweep: ${advanced}/${universes.length} universes advanced (${totalSteps} steps, ${ended} ended, ${failures.length} failed)`);

    return res.json({
      ok: true,
      scanned: universes.length,
      advanced,
      totalSteps,
      ended,
      failures
    });
  } catch (err) {
    console.error("Sweep error:", err);
    return res.status(500).json({ ok: false, error: "Sweep failed" });
  }
});

module.exports = router;
