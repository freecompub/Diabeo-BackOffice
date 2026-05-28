/**
 * @module idempotency/with-idempotency
 * @description HOF wrapper pour route handlers Next.js qui supporte
 * `Idempotency-Key` header (RFC convention).
 *
 * **Round 2 review PR #462** — 38 findings résolus :
 *
 * - H-HSA-3 + M-HSA-3 : preserve original headers (denylist `Set-Cookie`,
 *   `Date`, `Content-Length`) + force `Cache-Control: no-store` ANSSI RGS §4.5
 *   sur les 3 chemins (400/409/replay).
 * - H-HSA-2 + H-HSA-4 + M-CR-7 : audit `IDEMPOTENT_REPLAY` light sur replay +
 *   `accessDenied` US-2265 burst detection sur mismatch (forensique HDS L.1111-8).
 * - H-CR-2 : exclu transient `408 / 423 / 425 / 429` du cache (en plus des 5xx).
 * - H-TA-1 + M-CR-2 + LOW-CR-2 : JSON-only Content-Type whitelist (skip cache
 *   pour binaire/HTML, le handler exécute mais pas de store).
 * - M-CR-3 : cap response body à `MAX_RESPONSE_BYTES = 100_000` (anti
 *   Upstash facturation).
 * - M-HSA-1 : `assertBodySize` 64KB pré-clone (anti body race + DoS).
 * - M-HSA-2 : `parseInt` strict `/^\d+$/` userId (defense-in-depth vs CRLF).
 * - H-CR-5 : rate-limit per-user 1000/h sur l'envoi `Idempotency-Key` (anti
 *   amplification stockage Redis par ADMIN compromis).
 * - LOW-CR-7 : `requestId` propagé dans tous les logs idempotency (corrélation
 *   forensique cross-services Loki).
 * - LOW-HSA-2 : message FR `409` retiré, code i18n seul.
 */

import { NextResponse, type NextRequest } from "next/server"
import { logger } from "@/lib/logger"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { checkApiRateLimit } from "@/lib/auth/api-rate-limit"
import {
  idempotencyService,
  isValidIdempotencyKey,
  hashBody,
} from "./service"

type RouteHandler<Ctx> = (req: NextRequest, ctx: Ctx) => Promise<Response>

interface WithIdempotencyOptions {
  /** Identifiant lisible pour les logs (ex: "admin/users/[id] PATCH"). */
  route: string
}

/**
 * Sentinel header — utilisé côté client pour différencier replay vs exécution réelle.
 */
export const IDEMPOTENCY_REPLAYED_HEADER = "X-Idempotency-Replayed"

/** Cap requête body — pré-clone (M-HSA-1). */
const MAX_REQUEST_BYTES = 64 * 1024
/** Cap réponse cachée — anti facturation Upstash + cohérent avec PHI volumes Diabeo. */
const MAX_RESPONSE_BYTES = 100 * 1024

/**
 * Headers à NE PAS rejouer au replay (denylist H-HSA-3) :
 * - `set-cookie` : re-injecter un cookie de session ancien = confusion auth.
 * - `date` : doit refléter le moment du replay, pas l'original.
 * - `content-length` : recalculé par Next.js sur la nouvelle Response.
 * - `connection`, `transfer-encoding` : hop-by-hop RFC 7230.
 *
 * Tous les autres sont préservés (Cache-Control, X-Content-Type-Options,
 * Referrer-Policy, custom X-*). Le `Cache-Control: no-store` est forcé par
 * `addAnssiNoStore()` en sortie de toute façon (ANSSI §4.5).
 */
const HEADER_DENYLIST = new Set<string>([
  "set-cookie",
  "date",
  "content-length",
  "connection",
  "transfer-encoding",
])

/** Codes de retour à NE PAS cacher (H-CR-2) — transient ou serveur. */
function shouldSkipCache(status: number): boolean {
  if (status >= 500) return true // serveur transient
  if (status === 408) return true // Request Timeout (RFC 7231)
  if (status === 423) return true // Locked (WebDAV — pourrait être réutilisé)
  if (status === 425) return true // Too Early (RFC 8470)
  if (status === 429) return true // Too Many Requests (rate-limit — reset attendu)
  return false
}

/** Ne cache que les responses JSON (H-TA-1 + LOW-HSA-3). */
function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const ct = contentType.toLowerCase()
  return ct.startsWith("application/json") || ct.startsWith("application/problem+json")
}

/**
 * Filtre les headers d'une Response selon la denylist HEADER_DENYLIST.
 * Retourne un Record<string, string> safe-to-replay (H-HSA-3).
 */
function safeHeadersFromResponse(response: Response): Record<string, string> {
  const out: Record<string, string> = {}
  response.headers.forEach((value, name) => {
    if (!HEADER_DENYLIST.has(name.toLowerCase())) {
      out[name] = value
    }
  })
  return out
}

/**
 * Force `Cache-Control: no-store` + `Pragma: no-cache` + `X-Content-Type-Options:
 * nosniff` (ANSSI RGS §4.5) — appliqué aux 3 chemins du wrapper (400/409/replay).
 */
function applyAnssiHeaders(headers: Headers): void {
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
  headers.set("Pragma", "no-cache")
  headers.set("X-Content-Type-Options", "nosniff")
  headers.set("Referrer-Policy", "no-referrer")
}

/** Strict integer parsing (M-HSA-2) — refuse "1abc", "1\n", " 1 ", etc. */
function parseStrictPositiveInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : null
}

/** Rate-limit Idempotency-Key write — 1000/h/user (H-CR-5 anti Redis flooding). */
const IDEM_WRITE_RATE_LIMIT = {
  bucket: "idem-write",
  windowSec: 3600,
  max: 1000,
  failMode: "open" as const, // dédup pas critique si rate-limit Redis down
}

export function withIdempotency<Ctx>(
  handler: RouteHandler<Ctx>,
  options: WithIdempotencyOptions,
): RouteHandler<Ctx> {
  return async (req, ctx) => {
    const idemKey = req.headers.get("idempotency-key")

    // Pas de header → pass-through (rétro-compat).
    if (!idemKey) {
      return handler(req, ctx)
    }

    const auditCtx = extractRequestContext(req)
    const requestId = auditCtx.requestId

    // Validation format strict UUID v4.
    if (!isValidIdempotencyKey(idemKey)) {
      return jsonWithAnssi({ error: "invalidIdempotencyKey" }, 400)
    }

    // Récupère l'user-id pour scope (injecté par middleware JWT auth).
    // Parse strict (M-HSA-2) — defense-in-depth vs CRLF injection en amont.
    const userId = parseStrictPositiveInt(req.headers.get("x-user-id"))
    if (userId === null) {
      // Pas authentifié — laisse le handler renvoyer 401 (rétro-compat).
      return handler(req, ctx)
    }

    // Rate-limit per-user sur les writes idempotency (H-CR-5).
    const rl = await checkApiRateLimit(String(userId), IDEM_WRITE_RATE_LIMIT)
    if (!rl.allowed) {
      return jsonWithAnssi({ error: "idempotencyRateLimited" }, 429, {
        "Retry-After": String(rl.retryAfterSec),
      })
    }

    // Body size guard PRÉ-clone (M-HSA-1).
    const contentLength = parseStrictPositiveInt(req.headers.get("content-length"))
    if (contentLength !== null && contentLength > MAX_REQUEST_BYTES) {
      return jsonWithAnssi({ error: "requestBodyTooLarge" }, 413)
    }

    // Lit le body brut pour hash. `NextRequest.clone()` permet re-read.
    let rawBody = ""
    try {
      rawBody = await req.clone().text()
    } catch {
      // body unreadable → handler gérera l'erreur.
      logger.warn("idempotency", "body unreadable, pass-through", {
        kind: "idem.body.unreadable",
        requestId,
        action: options.route,
        userId,
      })
      return handler(req, ctx)
    }
    if (rawBody.length > MAX_REQUEST_BYTES) {
      return jsonWithAnssi({ error: "requestBodyTooLarge" }, 413)
    }
    const bodyHash = hashBody(rawBody)

    const lookup = await idempotencyService.lookup(idemKey, userId, bodyHash)

    if (lookup.type === "in_progress") {
      // Race window — handler concurrent exécute déjà (H-CR-3).
      return jsonWithAnssi({ error: "idempotencyInProgress" }, 409, {
        "Retry-After": "5",
      })
    }

    if (lookup.type === "mismatch") {
      // Forensique HDS — US-2265 burst detection (H-HSA-4 + H-HSA-2 + M-CR-7).
      logger.warn("idempotency", "key reused with different body", {
        kind: "idem.mismatch",
        requestId,
        action: options.route,
        userId,
        key: idemKey.slice(0, 8) + "…",
      })
      try {
        await auditService.accessDenied({
          userId,
          resource: "IDEMPOTENCY",
          resourceId: idemKey.slice(0, 8),
          ipAddress: auditCtx.ipAddress,
          userAgent: auditCtx.userAgent,
          requestId,
          metadata: { route: options.route, kind: "body_mismatch" },
        })
      } catch (err) {
        // Best-effort — pas de blocage de la 409.
        logger.warn("idempotency", "accessDenied audit failed", {
          kind: "idem.audit.failed",
          requestId,
          failMode: err instanceof Error ? err.message : String(err),
        })
      }
      return jsonWithAnssi({ error: "idempotencyMismatch" }, 409)
    }

    if (lookup.type === "replay") {
      // Forensique HDS L.1111-8 — replay tracé en audit (H-HSA-2).
      // Action = "READ" + resource = "IDEMPOTENCY" : lecture du cache, pas de
      // duplication de l'action originale.
      try {
        await auditService.log({
          userId,
          action: "READ",
          resource: "IDEMPOTENCY",
          resourceId: idemKey.slice(0, 8),
          ipAddress: auditCtx.ipAddress,
          userAgent: auditCtx.userAgent,
          requestId,
          metadata: { route: options.route, kind: "replay" },
        })
      } catch (err) {
        logger.warn("idempotency", "replay audit failed", {
          kind: "idem.audit.failed",
          requestId,
          failMode: err instanceof Error ? err.message : String(err),
        })
      }
      // Reconstruit la response avec headers originaux préservés (H-HSA-3) +
      // force no-store ANSSI.
      const headers = new Headers(lookup.headers)
      applyAnssiHeaders(headers)
      headers.set(IDEMPOTENCY_REPLAYED_HEADER, "true")
      return new NextResponse(lookup.body, {
        status: lookup.status,
        headers,
      })
    }

    // miss → acquire PENDING lock (H-CR-3 race window protection).
    const lockAcquired = await idempotencyService.acquirePendingLock(idemKey, userId)
    if (!lockAcquired) {
      return jsonWithAnssi({ error: "idempotencyInProgress" }, 409, {
        "Retry-After": "5",
      })
    }

    let response: Response
    try {
      response = await handler(req, ctx)
    } catch (err) {
      // Handler throw : release le lock pour qu'un retry futur puisse re-tenter.
      await idempotencyService.releasePending(idemKey, userId)
      throw err
    }

    // Strip transient codes (H-CR-2) + 5xx — release lock pour retry.
    if (shouldSkipCache(response.status)) {
      await idempotencyService.releasePending(idemKey, userId)
      return response
    }

    // JSON-only whitelist (H-TA-1) — skip caching pour binaire/HTML, le handler
    // a déjà exécuté donc la response est servie une fois.
    const responseContentType = response.headers.get("content-type")
    if (!isJsonContentType(responseContentType)) {
      await idempotencyService.releasePending(idemKey, userId)
      logger.debug?.("idempotency", "non-JSON response skipped cache", {
        kind: "idem.cache.skip_non_json",
        action: options.route,
      })
      return response
    }

    try {
      const cloned = response.clone()
      const responseBody = await cloned.text()
      if (responseBody.length > MAX_RESPONSE_BYTES) {
        // Response trop grosse (M-CR-3) — release lock + log warn + skip cache.
        await idempotencyService.releasePending(idemKey, userId)
        logger.warn("idempotency", "response too large, skipped cache", {
          kind: "idem.cache.too_large",
          requestId,
          action: options.route,
        })
        return response
      }
      const safeHeaders = safeHeadersFromResponse(response)
      await idempotencyService.store(
        {
          key: idemKey,
          bodyHash,
          status: response.status,
          body: responseBody,
          headers: safeHeaders,
        },
        userId,
      )
    } catch (err) {
      // Best-effort — la response a déjà été envoyée au client.
      logger.warn("idempotency", "failed to cache response (fail-open)", {
        kind: "idem.cache.failed",
        requestId,
        action: options.route,
        failMode: err instanceof Error ? err.message : String(err),
      })
      // Release lock pour permettre retry (le client n'a peut-être pas reçu).
      await idempotencyService.releasePending(idemKey, userId)
    }

    return response
  }
}

/**
 * Helper interne — construit une NextResponse JSON avec headers ANSSI forcés.
 */
function jsonWithAnssi(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): NextResponse {
  const headers = new Headers({ "Content-Type": "application/json" })
  applyAnssiHeaders(headers)
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v)
  }
  return new NextResponse(JSON.stringify(body), { status, headers })
}
