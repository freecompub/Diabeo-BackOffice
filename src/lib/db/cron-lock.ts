/**
 * @module db/cron-lock
 * @description Advisory lock SESSION-level garanti sur **la même connexion
 * physique** pendant tout le run cron.
 *
 * ### Pourquoi un pool dédié ?
 *
 * `@prisma/adapter-pg` (Prisma 7+) utilise un pool `node-postgres` partagé.
 * Chaque `prisma.$queryRaw` peut être routé sur une connexion différente.
 * Or `pg_advisory_lock` / `pg_advisory_unlock` sont **session-scoped** :
 *   - acquire sur connexion A → lock détenu par A.
 *   - release sur connexion B (autre run du pool) → no-op silencieux.
 *   - A garde le lock jusqu'à son recyclage (idle timeout pool ~10s).
 *
 * Conséquences si on utilise le pool Prisma partagé :
 *   - Cron 1 acquire sur A, release sur B → A garde le lock.
 *   - Cron 2 acquire (sur A ou D) → A garde lock → cron 2 skip.
 *   - Si A est recyclée pendant le cron (idle 10s < cron 50s), le lock
 *     disparaît à mi-run → cron 3 peut acquire → double-sends patients.
 *
 * ### Solution
 *
 * Un `pg.Pool({ max: 1, idleTimeoutMillis: 0 })` dédié au lock cron.
 *   - max: 1 → un seul client physique, acquire et release garantis sur
 *     la même connexion (et donc même session PostgreSQL).
 *   - idleTimeoutMillis: 0 → la connexion ne se ferme jamais → le lock ne
 *     disparaît jamais à mi-run.
 *   - Le client est `connect()` + `release()` manuel → durée du lock =
 *     durée du `withSessionAdvisoryLock` exactement.
 *
 * Le reste du cron continue d'utiliser `prisma` normalement (parallelism
 * via le pool partagé).
 *
 * @see appointment-reminder.service.ts (round 3 CR-1 fix)
 */

import { Pool, type PoolClient } from "pg"
import { logger } from "@/lib/logger"

let cronLockPool: Pool | null = null

function getCronLockPool(): Pool {
  if (cronLockPool) return cronLockPool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required for cron lock pool. " +
        "See docs/local-development.md §3.",
    )
  }
  cronLockPool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 5_000,
  })
  cronLockPool.on("error", (err) => {
    logger.error(
      "cron-lock",
      "pool client unexpected error",
      { kind: "pool.error" },
      err,
    )
  })
  return cronLockPool
}

/**
 * Wrap un cron `fn` dans un advisory lock SESSION-level.
 *
 * Garanties :
 *   - `pg_try_advisory_lock(hashtextextended(key, 0))` exécuté sur la même
 *     connexion physique que `pg_advisory_unlock(...)` (pool max:1).
 *   - Si lock non acquis (autre run concurrent), retourne `null` sans
 *     exécuter `fn`.
 *   - Si `fn` throw, le release tourne quand même (finally).
 *   - Si `pg_advisory_unlock` retourne `false` (état anormal — lock leak),
 *     log warn `lock.release.no_op` pour observabilité (LOW-3 round 3).
 *
 * @param key Clé textuelle, hashée en bigint par `hashtextextended`.
 * @param fn Travail à exécuter sous lock (peut utiliser `prisma` librement).
 * @returns `null` si lock non acquis, sinon `await fn()`.
 */
export async function withSessionAdvisoryLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  const pool = getCronLockPool()
  const client: PoolClient = await pool.connect()
  try {
    const acquire = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [key],
    )
    if (!acquire.rows[0]?.locked) {
      return null
    }
    try {
      return await fn()
    } finally {
      try {
        const release = await client.query<{ unlocked: boolean }>(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked",
          [key],
        )
        if (release.rows[0]?.unlocked !== true) {
          // Anormal : la connexion n'a pas détenu le lock. Lock leak suspect.
          logger.error(
            "cron-lock",
            "advisory_unlock returned false — lock may be leaked",
            { kind: "lock.release.no_op", key },
          )
        }
      } catch (err) {
        // Best-effort : le lock SESSION s'éteindra à la fermeture client
        // (release au pool, max:1 + idleTimeoutMillis:0 = persistant).
        logger.error(
          "cron-lock",
          "advisory_unlock failed",
          { kind: "lock.release.failed", key },
          err,
        )
      }
    }
  } finally {
    client.release()
  }
}

/**
 * Reset le pool (tests uniquement). En prod, le pool est singleton process.
 *
 * @internal
 */
export function __resetCronLockPoolForTests(): void {
  if (cronLockPool) {
    cronLockPool.end().catch(() => undefined)
  }
  cronLockPool = null
}
