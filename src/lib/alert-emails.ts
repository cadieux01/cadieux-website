// Owner-alert email addressing, shared by every subsystem that needs to tell
// Sunny something went wrong with money.
//
// Extracted from /api/cron/daily-housekeeping when the orphaned-payment guard
// became a second caller. Two independent copies of this env parsing would
// drift the moment ABANDONED_ALERT_EMAIL is set in one place and not the
// other — and the failure mode is silent: alerts keep "sending", just not to
// whoever the operator thought they configured.

/** Verified Resend sender. */
export const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "Cadieux <hello@cadieux.in>";

/**
 * Who hears about money problems.
 *
 * Deliberately NOT reusing HANDOFF_ALERT_EMAIL — that address belongs to the
 * WhatsApp handoff subsystem and repointing it here would silently move those
 * alerts too.
 *
 * The env var keeps its original ABANDONED_ALERT_EMAIL name even though it now
 * also covers orphaned payments: it is already set in the deployed environment,
 * and renaming it would silently fall back to the default the next deploy.
 */
export const ALERT_EMAILS = (
  process.env.ABANDONED_ALERT_EMAIL || "ceo@cadieux.in,admin@cadieux.in"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
