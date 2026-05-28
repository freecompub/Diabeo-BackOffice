/**
 * @module idempotency
 * @description Idempotency-Key dedup service for state-changing HTTP routes
 * (POST/PUT/PATCH/DELETE).
 *
 * **Round 2 review PR #462** — 38 findings résolus :
 *
 * - C-HSA-1 (CRITICAL) : `JSON.parse(raw)` retiré — Upstash auto-désérialise via
 *   son Reviver SDK. Sans ce fix, 100 % des lookups en prod tombaient dans le
 *   fail-open silencieux et la dédup n'avait **aucun effet**.
 * - M-HSA-4 : `StoredEntrySchema` Zod runtime validation au lookup. Protège
 *   contre collision de namespace Redis ou injection XSS via cache empoisonné
 *   (`text/html` rejoué).
 * - H-CR-3 : NX advisory lock sentinel `"PENDING"` avec TTL 60s pour fenêtre de
 *   race lookup→store. 2 requêtes concurrentes même clé+body → 1 handler
 *   exécute, 2e reçoit 409 `idempotencyInProgress`.
 * - H-CR-4 : LRU cap `MEMORY_FALLBACK_MAX = 1000` entries (anti OOM si Upstash
 *   absent en prod). Eviction FIFO insertion order + log alert si `IS_PRODUCTION`.
 * - H-HSA-1 : Body de la response cachée **chiffré AES-256-GCM** via
 *   `encryptField`/`safeDecryptField` (ADR #2 — Upstash chiffre at-rest mais ce
 *   n'est PAS un substitut au chiffrement applicatif Diabeo). Wipe scan+del par
 *   user via `purgeUserKeys(userId)` consommé par RGPD Art. 17.
 * - M-HSA-5 : `REDIS_KEY_PREFIX` validé `assertRequiredEnv` (cf. `env.ts`)
 *   pour éviter pollution prod si dev oublie l'env var.
 * - LOW-HSA-4 : métriques `logger.debug` sur miss/replay/mismatch pour US-2153.
 *
 * Aligné `redis-cache.ts` pattern (pas de JSON.parse manuel, fail-open posture).
 */

import { Redis } from "@upstash/redis"
import { createHash } from "crypto"
import { z } from "zod"
import { logger } from "@/lib/logger"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"

const IDEMPOTENCY_PREFIX = `${process.env.REDIS_KEY_PREFIX ?? "diabeo:prod:"}idem:`
const TTL_SECONDS = 24 * 3600 // RFC 7231 Retry-After convention
const PENDING_LOCK_TTL_SECONDS = 60 // NX sentinel TTL — handler exec budget
const PENDING_SENTINEL = "PENDING" as const
const MEMORY_FALLBACK_MAX = 1000 // LRU cap anti-OOM en mode fallback prod
const IS_PRODUCTION = process.env.NODE_ENV === "production"

// ─────────────────────────────────────────────────────────────
// Redis client (singleton, lazy)
// ─────────────────────────────────────────────────────────────

let redis: Redis | null = null

function getRedis(): Redis | null {
  if (redis) return redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  redis = new Redis({ url, token })
  return redis
}

/**
 * In-memory fallback (dev/test). Map insertion order = FIFO eviction quand
 * `size > MEMORY_FALLBACK_MAX`. Pas de TTL background sweep (lookup balaie
 * paresseusement). Log alert si on tombe dans ce path en prod (H-CR-4).
 */
const memoryFallback = new Map<string, StoredEntry | typeof PENDING_SENTINEL>()
let memoryFallbackWarnedInProd = false

function memorySet(key: string, value: StoredEntry | typeof PENDING_SENTINEL): void {
  if (IS_PRODUCTION && !memoryFallbackWarnedInProd) {
    logger.warn("idempotency", "memory fallback in production — Upstash unreachable", {
      kind: "idem.memory_fallback.production",
    })
    memoryFallbackWarnedInProd = true
  }
  // LRU eviction : si capacité atteinte, drop la plus ancienne entrée
  if (memoryFallback.size >= MEMORY_FALLBACK_MAX) {
    const firstKey = memoryFallback.keys().next().value
    if (firstKey !== undefined) memoryFallback.delete(firstKey)
  }
  memoryFallback.set(key, value)
}

// ─────────────────────────────────────────────────────────────
// Types + Zod validation
// ─────────────────────────────────────────────────────────────

/**
 * Zod schema pour StoredEntry — validation runtime au lookup (M-HSA-4).
 * Refuse collision namespace ou injection (response.body remplacé par HTML).
 * - `bodyHash` : 64 hex chars SHA-256.
 * - `status` : 200-499 (5xx pas cachés cf. with-idempotency.ts).
 * - `bodyEnc` : base64 de `encrypt()` chiffré AES-256-GCM (H-HSA-1).
 * - `headers` : Record<string, string> filtré (denylist Set-Cookie en amont).
 * - `ttlAt` : ms epoch.
 */
const StoredEntrySchema = z.object({
  bodyHash: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.number().int().min(200).max(499),
  bodyEnc: z.string().min(1).max(200_000), // base64 chiffré ≈ 1.33× plaintext
  headers: z.record(z.string(), z.string()),
  ttlAt: z.number().int().positive(),
})

export type StoredEntry = z.infer<typeof StoredEntrySchema>

export type IdempotencyLookup =
  | { type: "miss" } // pas d'entrée → handler doit exécuter
  | { type: "in_progress" } // sentinel PENDING détecté → 409 in-progress (race window)
  | { type: "replay"; status: number; body: string; headers: Record<string, string> } // hit valide → renvoyer cached
  | { type: "mismatch" } // hit mais body différent → 409

export interface StoreInput {
  key: string
  bodyHash: string
  status: number
  body: string
  /**
   * Headers à rejouer. Le caller doit déjà avoir filtré la denylist
   * (Set-Cookie, Date, Content-Length) — cf. `with-idempotency.ts`.
   */
  headers: Record<string, string>
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Valide format `Idempotency-Key` — UUID v4 strict (cohérent UI
 * `crypto.randomUUID()` PR #461 + RFC 4122).
 */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidIdempotencyKey(key: string | null): key is string {
  return typeof key === "string" && UUID_V4_RE.test(key)
}

/**
 * Hash SHA-256 d'un body texte (avant parsing JSON pour stabilité bytewise).
 */
export function hashBody(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex")
}

function buildKey(idemKey: string, userId: number): string {
  // Scope par user pour empêcher cross-user replay (sécurité).
  return `${IDEMPOTENCY_PREFIX}u${userId}:${idemKey}`
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const idempotencyService = {
  /**
   * Lookup une clé. Retourne `miss` (pas d'entrée), `in_progress` (sentinel
   * PENDING détecté — race window), `replay` (hit valide, body déchiffré),
   * ou `mismatch` (hit mais body hash différent).
   */
  async lookup(
    idemKey: string,
    userId: number,
    bodyHash: string,
  ): Promise<IdempotencyLookup> {
    const fullKey = buildKey(idemKey, userId)
    const client = getRedis()

    try {
      let raw: unknown = null
      if (client) {
        // Upstash auto-désérialise via son Reviver SDK — pas de JSON.parse manuel.
        // (C-HSA-1 — sans ce fix, le bug rendait la dédup totalement inopérante.)
        raw = await client.get(fullKey)
      } else {
        const entry = memoryFallback.get(fullKey)
        if (entry === PENDING_SENTINEL) {
          return { type: "in_progress" }
        }
        if (entry && entry.ttlAt > Date.now()) {
          raw = entry
        } else if (entry) {
          memoryFallback.delete(fullKey)
        }
      }

      if (!raw) {
        logger.debug?.("idempotency", "lookup miss", { kind: "idem.lookup.miss" })
        return { type: "miss" }
      }

      // Sentinel PENDING : race window — handler concurrent en cours.
      if (raw === PENDING_SENTINEL) {
        return { type: "in_progress" }
      }

      // Validation Zod runtime (M-HSA-4 anti-corruption / collision namespace).
      const parsed = StoredEntrySchema.safeParse(raw)
      if (!parsed.success) {
        logger.warn("idempotency", "stored entry failed schema validation", {
          kind: "idem.lookup.invalid_entry",
        })
        return { type: "miss" }
      }
      const entry = parsed.data

      if (entry.bodyHash !== bodyHash) {
        logger.debug?.("idempotency", "lookup mismatch", { kind: "idem.lookup.mismatch" })
        return { type: "mismatch" }
      }

      // Déchiffrement AES-256-GCM body (H-HSA-1 PHI protected at-cache).
      const body = safeDecryptField(entry.bodyEnc)
      if (body === null) {
        // Decrypt fail (clé rotée ?) — fail-open : exécute le handler.
        logger.warn("idempotency", "body decrypt failed (key rotation?)", {
          kind: "idem.lookup.decrypt_failed",
        })
        return { type: "miss" }
      }
      logger.debug?.("idempotency", "lookup replay", { kind: "idem.lookup.replay" })
      return {
        type: "replay",
        status: entry.status,
        body,
        headers: entry.headers,
      }
    } catch (err) {
      logger.warn("idempotency", "lookup failed (fail-open)", {
        kind: "idem.lookup.failed",
        failMode: err instanceof Error ? err.message : String(err),
      })
      return { type: "miss" } // fail-open : pas pire qu'avant
    }
  },

  /**
   * Acquire un advisory lock sentinel `PENDING` (TTL 60s) pour la fenêtre de
   * handler-exec. Retourne `true` si lock acquis, `false` si déjà présent (race
   * concurrente détectée). Le caller doit relâcher via `store()` ou
   * `releasePending()`.
   *
   * Pattern Stripe/AWS — résout H-CR-3 (race window lookup → store).
   */
  async acquirePendingLock(
    idemKey: string,
    userId: number,
  ): Promise<boolean> {
    const fullKey = buildKey(idemKey, userId)
    const client = getRedis()
    try {
      if (client) {
        const result = await client.set(fullKey, PENDING_SENTINEL, {
          nx: true,
          ex: PENDING_LOCK_TTL_SECONDS,
        })
        return result === "OK"
      }
      // Memory fallback NX
      if (memoryFallback.has(fullKey)) return false
      memorySet(fullKey, PENDING_SENTINEL)
      return true
    } catch (err) {
      logger.warn("idempotency", "acquirePendingLock failed (fail-open)", {
        kind: "idem.lock.failed",
        failMode: err instanceof Error ? err.message : String(err),
      })
      return true // fail-open : pire = double exec, c'est acceptable
    }
  },

  /**
   * Libère un PENDING lock acquis mais sans response à stocker (ex: handler a
   * throw, ou response 5xx non cachée). Permet à un retry futur de re-tenter.
   */
  async releasePending(idemKey: string, userId: number): Promise<void> {
    const fullKey = buildKey(idemKey, userId)
    const client = getRedis()
    try {
      if (client) await client.del(fullKey)
      else memoryFallback.delete(fullKey)
    } catch (err) {
      logger.warn("idempotency", "releasePending failed (silent)", {
        kind: "idem.release.failed",
        failMode: err instanceof Error ? err.message : String(err),
      })
    }
  },

  /**
   * Store une response cachée pour replay futur (TTL 24h). Body chiffré
   * AES-256-GCM via `encryptField` (H-HSA-1).
   */
  async store(input: StoreInput, userId: number): Promise<void> {
    const fullKey = buildKey(input.key, userId)
    const client = getRedis()
    const entry: StoredEntry = {
      bodyHash: input.bodyHash,
      status: input.status,
      bodyEnc: encryptField(input.body),
      headers: input.headers,
      ttlAt: Date.now() + TTL_SECONDS * 1000,
    }

    try {
      if (client) {
        // Upstash auto-sérialise — passer l'objet directement (C-HSA-1).
        await client.set(fullKey, entry, { ex: TTL_SECONDS })
      } else {
        memorySet(fullKey, entry)
      }
      logger.debug?.("idempotency", "store success", { kind: "idem.store.success" })
    } catch (err) {
      logger.warn("idempotency", "store failed (fail-open)", {
        kind: "idem.store.failed",
        failMode: err instanceof Error ? err.message : String(err),
      })
      // fail-open : la response a déjà été envoyée au client, on log juste.
    }
  },

  /**
   * RGPD Art. 17 — purge toutes les clés idempotency pour un user (déclenchée
   * par `deletion.service.ts` lors de la suppression de compte).
   *
   * **Limites** : Upstash REST ne supporte pas `SCAN` natif. On émule via
   * `keys("pattern")` qui est O(N) sur l'espace clé — acceptable car appelé
   * uniquement sur deletion (faible fréquence).
   */
  async purgeUserKeys(userId: number): Promise<{ deleted: number }> {
    const pattern = `${IDEMPOTENCY_PREFIX}u${userId}:*`
    const client = getRedis()
    try {
      if (client) {
        const keys = await client.keys(pattern)
        if (keys.length === 0) return { deleted: 0 }
        await client.del(...keys)
        return { deleted: keys.length }
      }
      // Memory fallback : iterate + delete
      let deleted = 0
      const prefix = `${IDEMPOTENCY_PREFIX}u${userId}:`
      for (const key of memoryFallback.keys()) {
        if (key.startsWith(prefix)) {
          memoryFallback.delete(key)
          deleted++
        }
      }
      return { deleted }
    } catch (err) {
      logger.warn("idempotency", "purgeUserKeys failed", {
        kind: "idem.purge.failed",
        userId,
        failMode: err instanceof Error ? err.message : String(err),
      })
      return { deleted: 0 }
    }
  },

  /**
   * Test-only — vide le cache in-memory. NE PAS appeler en prod.
   * Whitelist `test`/`vitest` (M-CR-6) au lieu de blacklist production.
   */
  __resetMemoryForTests(): void {
    if (
      process.env.NODE_ENV !== "test" &&
      process.env.VITEST !== "true"
    ) {
      throw new Error("test-only: __resetMemoryForTests requires NODE_ENV=test or VITEST=true")
    }
    memoryFallback.clear()
    memoryFallbackWarnedInProd = false
  },

  /**
   * Test-only — reset le singleton Redis client pour permettre de re-test la
   * branche client null vs initialisé (M8 round 2).
   */
  __resetRedisClientForTests(): void {
    if (
      process.env.NODE_ENV !== "test" &&
      process.env.VITEST !== "true"
    ) {
      throw new Error("test-only: __resetRedisClientForTests requires NODE_ENV=test or VITEST=true")
    }
    redis = null
  },
}
