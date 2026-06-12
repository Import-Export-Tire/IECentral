import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run auto-archive every day at 2 AM UTC
crons.daily(
  "auto-archive-done-projects",
  { hourUTC: 2, minuteUTC: 0 },
  internal.projects.autoArchiveOldDoneProjects
);

// Run auto-expire old applications every day at 3 AM UTC
// Archives applications older than 45 days that are still in stagnant statuses
crons.daily(
  "auto-expire-old-applications",
  { hourUTC: 3, minuteUTC: 0 },
  internal.applications.autoExpireOldApplications
);

// Send weekly daily log digest to admins every Monday at 9 AM EST (14:00 UTC)
crons.weekly(
  "weekly-daily-log-digest",
  { dayOfWeek: "monday", hourUTC: 14, minuteUTC: 0 },
  internal.dailyLogs.sendWeeklyDigestEmails
);

// Clean up dealer rebate uploads older than 12 months - runs monthly on the 1st
crons.monthly(
  "cleanup-old-dealer-rebate-uploads",
  { day: 1, hourUTC: 6, minuteUTC: 0 },
  internal.dealerRebates.deleteOldUploads
);

// ============ EMAIL CLIENT CRONS ============

// Sync all email accounts. Kept infrequent (every 5 min) on purpose: opening the
// email page triggers a visible sync for that account, so this background poll is
// just a safety net. Polling every minute was hammering self-hosted mail servers
// (e.g. svm.ietires.com) into rate-limiting / fail2ban and refusing connections.
crons.interval(
  "email-sync-all-accounts",
  { minutes: 5 },
  internal.email.sync.syncAllAccounts
);

// Clean up old cached emails (older than 30 days) - runs daily at 4 AM UTC
crons.daily(
  "email-cleanup-old-emails",
  { hourUTC: 4, minuteUTC: 0 },
  internal.email.emails.cleanupOldEmails
);

// Process scheduled emails every minute
crons.interval(
  "email-process-scheduled-sends",
  { minutes: 1 },
  internal.email.send.processScheduledSends
);

// Retry failed emails every 5 minutes
crons.interval(
  "email-retry-failed-sends",
  { minutes: 5 },
  internal.email.send.retryFailedSends
);

// Process snoozed emails every minute
crons.interval(
  "email-process-snoozed",
  { minutes: 1 },
  internal.email.snooze.processDueSnoozes
);

// Clean up old send queue entries daily at 5 AM UTC
crons.daily(
  "email-cleanup-send-queue",
  { hourUTC: 5, minuteUTC: 0 },
  internal.email.sendMutations.cleanupOldQueueEntries,
  {}
);

// Clean up old audit logs (keep 1 year) - runs weekly on Sunday at 3 AM UTC
crons.weekly(
  "email-cleanup-audit-logs",
  { dayOfWeek: "sunday", hourUTC: 3, minuteUTC: 0 },
  internal.email.audit.cleanup,
  {}
);

// Clean up old analytics (keep 1 year) - runs monthly on the 1st at 4 AM UTC
crons.monthly(
  "email-cleanup-analytics",
  { day: 1, hourUTC: 4, minuteUTC: 0 },
  internal.email.analytics.cleanup,
  {}
);

// Clean up old read receipts (keep 90 days) - runs daily at 5 AM UTC
crons.daily(
  "email-cleanup-read-receipts",
  { hourUTC: 5, minuteUTC: 30 },
  internal.email.readReceipts.cleanup,
  {}
);

// ============ SCANNER MDM CRONS ============

// Clean up expired scanner provision codes (null out cert data)
crons.daily(
  "scanner-cleanup-expired-provision-codes",
  { hourUTC: 3, minuteUTC: 30 },
  internal.scannerMdm.cleanupExpiredProvisionCodes
);

// Mark scanners as offline if no telemetry received in 5 minutes
crons.interval(
  "scanner-update-online-status",
  { minutes: 5 },
  internal.scannerMdm.bulkUpdateOnlineStatus
);

export default crons;
