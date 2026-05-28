/**
 * @module idempotency
 * @description Idempotency-Key dedup service for state-changing HTTP routes
 * (POST/PUT/PATCH/DELETE).
 *
 * Plan B follow-up A1 — résout HSA L2 PR #461 (UI envoie déjà le header mais
 * backend ne dedup pas → audit log spam si user double-click).
 *
 * **Contract** :
 *   - Client envoie header `Idempotency-Key: <uuid>` (idempotent par convention RFC).
 *   - Premier appel : handler exécute, response stockée Redis 24h, headers
 *     `Idempotency-Replayed: false`.
 *   - Replay même clé + même body : retourne response cachée, headers
 *     `Idempotency-Replayed: true` (no-op backend, pas de side-effect).
 *   - Replay même clé + body différent : 409 Conflict + audit `idempotency.mismatch`.
 *
 * **Body hashing** : SHA-256 du body brut (avant parsing). Si différent du cached,
 * c'est une violation contractuelle client → reject.
 *
 * **Fail mode** : si Redis unreachable, fallback in-memory dev/test. En prod
 * sans Redis, accept failure (no dedup) — meilleur que 500 sur action critique.
 *
 * Aligné `api-rate-limit.ts` pattern (Redis Upstash + memory fallback).
 */

import { Redis } from "@upstash/redis"
import { createHash } from "crypto"
import { logger } from "@/lib/logger"

const IDEMPOTENCY_PREFIX = `${process.env.REDIS_KEY_PREFIX ?? "diabeo:prod:"}idem:`
const TTL_SECONDS = 24 * 3600 // RFC 7231 retry-After convention

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

// In-memory fallback (dev/test). Map `key → { bodyHash, status, body, ttlAt }`.
const memoryFallback = new Map<string, StoredEntry>()

interface StoredEntry {
  bodyHash: string
  status: number
  body: string // JSON-serialized response
  contentType: string
  ttlAt: number // ms epoch
}

// ─────────────────────────────────────────────────────────────
// Types public
// ─────────────────────────────────────────────────────────────

export type IdempotencyLookup =
  | { type: "miss" } // pas d'entrée → handler doit exécuter
  | { type: "replay"; status: number; body: string; contentType: string } // hit valide → renvoyer cached
  | { type: "mismatch" } // hit mais body différent → 409

export interface StoreInput {
  key: string
  bodyHash: string
  status: number
  body: string
  contentType: string
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
   * Lookup une clé. Retourne `miss` (pas d'entrée), `replay` (hit valide),
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
      let raw: string | null = null
      if (client) {
        raw = await client.get<string>(fullKey)
      } else {
        const entry = memoryFallback.get(fullKey)
        if (entry && entry.ttlAt > Date.now()) {
          raw = JSON.stringify(entry)
        } else if (entry) {
          memoryFallback.delete(fullKey)
        }
      }

      if (!raw) return { type: "miss" }

      const parsed = JSON.parse(raw) as StoredEntry
      if (parsed.bodyHash !== bodyHash) {
        return { type: "mismatch" }
      }
      return {
        type: "replay",
        status: parsed.status,
        body: parsed.body,
        contentType: parsed.contentType,
      }
    } catch (err) {
      logger.warn("idempotency", "lookup failed (fail-open)", { kind: "idem.lookup.failed", failMode: err instanceof Error ? err.message : String(err) })
      return { type: "miss" } // fail-open : pas pire qu'avant
    }
  },

  /**
   * Store une response cachée pour replay futur (TTL 24h).
   */
  async store(input: StoreInput, userId: number): Promise<void> {
    const fullKey = buildKey(input.key, userId)
    const client = getRedis()
    const entry: StoredEntry = {
      bodyHash: input.bodyHash,
      status: input.status,
      body: input.body,
      contentType: input.contentType,
      ttlAt: Date.now() + TTL_SECONDS * 1000,
    }

    try {
      if (client) {
        await client.set(fullKey, JSON.stringify(entry), { ex: TTL_SECONDS })
      } else {
        memoryFallback.set(fullKey, entry)
      }
    } catch (err) {
      logger.warn("idempotency", "store failed (fail-open)", { kind: "idem.store.failed", failMode: err instanceof Error ? err.message : String(err) })
      // fail-open : la response a déjà été envoyée au client, on log juste.
    }
  },

  /**
   * Test-only — vide le cache in-memory. NE PAS appeler en prod.
   */
  __resetMemoryForTests(): void {
    if (process.env.NODE_ENV === "production") {
      throw new Error("test-only: __resetMemoryForTests disallowed in production")
    }
    memoryFallback.clear()
  },
}
