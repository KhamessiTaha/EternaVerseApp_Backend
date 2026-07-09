const User = require("../models/User");

/**
 * Server-side admin gate for dev/test endpoints. Runs AFTER verifyToken.
 *
 * Always checks the database rather than a JWT claim, so revoking the flag
 * takes effect immediately and a tampered/stale token can never grant
 * access. Non-admins get a 404 (not 403) so the dev endpoints don't
 * advertise their existence.
 */
async function requireAdmin(req, res, next) {
  try {
    const user = await User.findById(req.user.id).select("isAdmin").lean();
    if (!user?.isAdmin) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }
    next();
  } catch (err) {
    console.error("Admin check failed:", err.message);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

module.exports = requireAdmin;
