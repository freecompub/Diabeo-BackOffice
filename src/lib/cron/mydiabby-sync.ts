/**
 * MyDiabby hourly sync cron — staging only.
 *
 * Registers a setInterval that triggers syncAllAccounts() every hour.
 * The cron refuses to start if APP_ENV is "production".
 *
 * This module should be imported once at app startup (e.g., in instrumentation.ts
 * or a custom server entry point) to register the interval.
 *
 * @see US-900 — Synchronisation des données depuis MyDiabby
 */

import { syncAllAccounts } from "@/lib/services/mydiabby-sync.service"

const SYNC_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

let intervalId: ReturnType<typeof setInterval> | null = null

/**
 * Start the hourly sync cron. No-op if already started or if in production.
 */
export function startMyDiabbySyncCron(): void {
  if (process.env.APP_ENV === "production") {
    console.log("[mydiabby-cron] Disabled in production")
    return
  }

  if (intervalId) {
    console.log("[mydiabby-cron] Already running")
    return
  }

  console.log("[mydiabby-cron] Starting hourly sync")

  // Run immediately on start, then every hour
  runSync()
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
  }
}
