/**
 * MyDiabby hourly sync cron — staging only.
 *
 * Registers a setInterval that triggers syncAllAccounts() every hour.
 * The cron only starts if APP_ENV === "staging" (explicit opt-in).
 *
 * Limitations (acceptable for staging):
 * - setInterval does not survive process restarts
 * - No distributed lock (single-instance only)
 * - For production-grade scheduling, use pg-boss or OS cron
 *
 * @see US-900 — Synchronisation des données depuis MyDiabby
 */

import { syncAllAccounts } from "@/lib/services/mydiabby-sync.service"

const SYNC_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

let intervalId: ReturnType<typeof setInterval> | null = null
let isRunning = false // Mutex to prevent overlapping runs

/**
 * Start the hourly sync cron. No-op if already started or if not in staging.
 */
export function startMyDiabbySyncCron(): void {
  if (process.env.APP_ENV !== "staging") {
    console.log("[mydiabby-cron] Disabled — only runs in staging (APP_ENV=staging)")
    return
  }

  if (intervalId) {
    console.log("[mydiabby-cron] Already running")
    return
  }

  console.log("[mydiabby-cron] Starting hourly sync")
  intervalId = setInterval(runSync, SYNC_INTERVAL_MS)
}

/**
 * Stop the hourly sync cron.
 */
export function stopMyDiabbySyncCron(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    console.log("[mydiabby-cron] Stopped")
  }
}

async function runSync(): Promise<void> {
  // Mutex — skip if previous run is still active
  if (isRunning) {
    console.log("[mydiabby-cron] Skipping — previous sync still running")
    return
  }

  isRunning = true
  try {
    const results = await syncAllAccounts()
    const successCount = results.filter((r) => r.status === "success").length
    const errorCount = results.filter((r) => r.status === "error").length

    if (results.length > 0) {
      console.log(
        `[mydiabby-cron] Sync completed: ${successCount} success, ${errorCount} errors out of ${results.length} accounts`,
      )
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    console.error("[mydiabby-cron] Sync failed:", msg)
  } finally {
    isRunning = false
  }
}
