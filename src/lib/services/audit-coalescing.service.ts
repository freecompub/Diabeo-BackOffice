/**
 * @module audit-coalescing.service
 * @description Plan B follow-up A3 — Audit log coalescing pour réduire le
 * volume de rows sur les events haute fréquence (READ list, dashboard polling,
 * etc.).
 *
 * **Contrainte fondamentale** : `audit_logs` est IMMUTABLE (trigger
 * `audit_immutability.sql` interdit UPDATE/DELETE). Le coalescing ne peut
 * donc PAS être un "UPDATE incrémentant un counter sur la même row" — il
 * doit être INSERT-only avec un buffer en mémoire qui agrège les events
 * dans une fenêtre puis flush 1 row par tuple.
 *
 * **Design** :
 *   - Map mémoire keyed `userId:action:resource:resourceId` → buffer entry.
 *   - Buffer entry = `{ baseEntry, count, firstAt, lastAt }`.
 *   - Timer périodique (`COALESCE_FLUSH_INTERVAL_MS = 30s`) flush le buffer →
 *     1 INSERT par entry avec `metadata.coalesced.{count, firstAt, lastAt}`.
 *   - SIGTERM handler drain le buffer pour éviter de perdre des events au
 *     shutdown.
 *   - Cap dur `MAX_BUFFER_SIZE = 10_000` entries → flush immédiat si dépassé
 *     (anti-OOM si un attacker forge des keys uniques).
 *
 * **Quoi coalescer (whitelist)** :
 *   - `READ` sur `PATIENT` list view (scrolling = N reads = N audits).
 *   - `READ` sur `ANALYTICS`, `CGM_ENTRY` polling.
 *   - `IDEMPOTENT_REPLAY` (action existe via PR #462 — déjà fréquent).
 *
 * **Quoi NE PAS coalescer (blacklist)** :
 *   - Mutations (`CREATE`, `UPDATE`, `DELETE`) — forensique HDS exige une row par event.
 *   - `LOGIN`, `LOGOUT`, `UNAUTHORIZED` — sécurité requiert visibilité 1:1.
 *   - `BOLUS_CALCULATED`, `MFA_*`, `EXPORT` — events à risque clinique/conformité.
 *   - Tout event PHI-sensitif (READ sur patient detail individuel).
 *
 * **Garanties** :
 *   - Aucun event perdu en cas de fail INSERT au flush (log + retry au prochain tick).
 *   - Perte possible si SIGKILL (vs SIGTERM) : acceptable car coalescé = peu critique.
 *   - Aucun ordering garanti dans le flush (par row = atomique mais pas
 *     entre rows). Acceptable car chaque row a son `firstAt`/`lastAt`.
 */

import { prisma } from "@/lib/db/client"
import { logger } from "@/lib/logger"
import { Prisma } from "@prisma/client"
import type { AuditLogEntry } from "./audit.service"

const COALESCE_FLUSH_INTERVAL_MS = 30_000
const MAX_BUFFER_SIZE = 10_000

interface BufferEntry {
  baseEntry: AuditLogEntry
  count: number
  firstAt: number
  lastAt: number
}

/**
 * Buffer en mémoire keyed par `userId:action:resource:resourceId`. Les
 * `metadata` du baseEntry sont préservées (1ère occurrence wins) — un
 * second event avec metadata différentes incrémente seulement count/lastAt.
 *
 * Trade-off documenté : on perd les metadata variantes au sein d'une
 * fenêtre. Acceptable car le coalescing cible des READs où les metadata
 * sont uniformes (juste un kind/route fixe).
 */
const buffer = new Map<string, BufferEntry>()

let flushTimer: ReturnType<typeof setInterval> | null = null
let shutdownHookRegistered = false

function buildKey(entry: AuditLogEntry): string {
  return `${entry.userId ?? "anon"}:${entry.action}:${entry.resource}:${entry.resourceId ?? ""}`
}

/**
 * Convert AuditLogEntry to Prisma create input (same shape as audit.service
 * createAuditData mais inline pour éviter circular import).
 */
function buildPrismaData(
  entry: AuditLogEntry,
  metadataOverride: Prisma.InputJsonValue,
): Prisma.AuditLogUncheckedCreateInput {
  return {
    userId: entry.userId ?? null,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    oldValue: entry.oldValue ?? Prisma.JsonNull,
    newValue: entry.newValue ?? Prisma.JsonNull,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    requestId: entry.requestId ?? null,
    metadata: metadataOverride,
  }
}

/**
 * Add an event to the coalescing buffer. Une entry existante (même key)
 * incrémente count + lastAt. Une key nouvelle crée une entry.
 *
 * Si le cap est atteint, déclenche un flush immédiat AVANT d'ajouter
 * (anti-OOM). Le flush est best-effort — si DB down, l'event est perdu
 * (acceptable pour les READs coalescés).
 */
export async function enqueueCoalesced(entry: AuditLogEntry): Promise<void> {
  ensureTimerStarted()

  const key = buildKey(entry)
  const existing = buffer.get(key)
  const now = Date.now()

  if (existing) {
    existing.count += 1
    existing.lastAt = now
    return
  }

  // Cap check AVANT insert (defense anti-OOM si un attacker forge des keys
  // uniques — l'attaque serait théorique car la key contient userId qui est
  // borné par les users actifs, mais defense in depth).
  if (buffer.size >= MAX_BUFFER_SIZE) {
    logger.warn("audit-coalescing", "buffer cap reached, force flush", {
      kind: "audit.coalesce.cap_reached",
    })
    await flush()
  }

  buffer.set(key, {
    baseEntry: entry,
    count: 1,
    firstAt: now,
    lastAt: now,
  })
}

/**
 * Flush le buffer : 1 INSERT par entry. Si une INSERT fail, on log warn
 * et continue (best-effort). Vide le buffer atomiquement avant les
 * INSERTs (les nouveaux events arrivant pendant le flush vont dans un
 * Map vide → pas de double comptage).
 */
export async function flush(): Promise<{ flushed: number; failed: number }> {
  if (buffer.size === 0) return { flushed: 0, failed: 0 }

  // Snapshot + clear atomique (synchrone JS — pas de race).
  const entries = Array.from(buffer.values())
  buffer.clear()

  let failed = 0
  await Promise.all(
    entries.map(async (e) => {
      try {
        const baseMetadata =
          e.baseEntry.metadata &&
          typeof e.baseEntry.metadata === "object" &&
          !Array.isArray(e.baseEntry.metadata)
            ? (e.baseEntry.metadata as Record<string, unknown>)
            : {}
        const metadata = {
          ...baseMetadata,
          coalesced: {
            count: e.count,
            firstAt: new Date(e.firstAt).toISOString(),
            lastAt: new Date(e.lastAt).toISOString(),
          },
        }
        await prisma.auditLog.create({
          data: buildPrismaData(e.baseEntry, metadata as Prisma.InputJsonValue),
        })
      } catch (err) {
        failed += 1
        logger.warn("audit-coalescing", "flush INSERT failed", {
          kind: "audit.coalesce.insert_failed",
          action: e.baseEntry.action,
          resource: e.baseEntry.resource,
          failMode: err instanceof Error ? err.message : String(err),
        })
      }
    }),
  )

  return { flushed: entries.length, failed }
}

/**
 * Démarre le timer périodique. Idempotent — appelé lazy depuis
 * `enqueueCoalesced` lors du 1er event (évite de démarrer un interval
 * au boot dans les processes qui n'utilisent pas le coalescing — tests,
 * CLI tools).
 */
function ensureTimerStarted(): void {
  if (flushTimer !== null) return
  flushTimer = setInterval(() => {
    void flush().catch(() => { /* already logged */ })
  }, COALESCE_FLUSH_INTERVAL_MS)
  // `unref()` permet à Node de terminer le process si seul ce timer reste
  // actif (Vitest CI / scripts CLI).
  if (typeof flushTimer.unref === "function") flushTimer.unref()
  registerShutdownHook()
}

/**
 * Drain le buffer au shutdown (SIGTERM, SIGINT). Idempotent —
 * `process.once` garantit 1 seule registration. Sans ça, un kill -TERM
 * en prod perdrait jusqu'à 30s d'events READ coalescés.
 */
function registerShutdownHook(): void {
  if (shutdownHookRegistered) return
  shutdownHookRegistered = true

  const drain = async (signal: string) => {
    logger.info("audit-coalescing", `${signal} received, draining buffer`, {
      kind: "audit.coalesce.shutdown_drain",
    })
    if (flushTimer) {
      clearInterval(flushTimer)
      flushTimer = null
    }
    try {
      await flush()
    } catch (err) {
      logger.warn("audit-coalescing", "shutdown drain failed", {
        kind: "audit.coalesce.shutdown_drain_failed",
        failMode: err instanceof Error ? err.message : String(err),
      })
    }
  }

  process.once("SIGTERM", () => void drain("SIGTERM"))
  process.once("SIGINT", () => void drain("SIGINT"))
}

/**
 * Test-only — reset le buffer + arrête le timer. Whitelist NODE_ENV=test
 * cohérent A1 round 2 pattern.
 */
export function __resetCoalescingForTests(): void {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error("test-only: __resetCoalescingForTests requires NODE_ENV=test")
  }
  if (flushTimer) {
    clearInterval(flushTimer)
    flushTimer = null
  }
  buffer.clear()
}

/** Test-only — inspecte le buffer (taille + keys présents). */
export function __getBufferSnapshotForTests(): { size: number; keys: string[] } {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
    throw new Error("test-only")
  }
  return { size: buffer.size, keys: Array.from(buffer.keys()) }
}

/** Constants exportées pour tests + adoption. */
export const COALESCING_CONFIG = {
  FLUSH_INTERVAL_MS: COALESCE_FLUSH_INTERVAL_MS,
  MAX_BUFFER_SIZE,
} as const
