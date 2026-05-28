/**
 * @module idempotency/with-idempotency
 * @description HOF wrapper pour route handlers Next.js qui supporte
 * `Idempotency-Key` header (RFC convention).
 *
 * Usage minimal :
 * ```ts
 * export const PATCH = withIdempotency(async (req, { params }) => {
 *   // handler classique — exécution une seule fois pour un Idempotency-Key
 * }, { route: "admin/users/[id] PATCH" })
 * ```
 *
 * Comportement :
 *   - Si pas de header : handler exécute normalement (rétro-compatible).
 *   - Si header invalide (pas UUID v4) : 400 `invalidIdempotencyKey`.
 *   - Si header présent + cached (même body hash) : retourne response cachée
 *     + header `Idempotency-Replayed: true` (sans ré-exécuter le handler).
 *   - Si header présent + cached (body différent) : 409 `idempotencyMismatch`.
 *   - Si header présent + miss : handler exécute, response stockée 24h.
 *
 * Le scope est par-user (lookup user via header `x-user-id` injecté middleware).
 * Empêche cross-user replay (sécurité).
 */

import { NextResponse, type NextRequest } from "next/server"
import { logger } from "@/lib/logger"
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

    // Validation format strict UUID v4.
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "invalidIdempotencyKey" },
        { status: 400 },
      )
    }

    // Récupère l'user-id pour scope (injecté par middleware JWT auth).
    const userIdHeader = req.headers.get("x-user-id")
    const userId = userIdHeader ? Number.parseInt(userIdHeader, 10) : NaN
    if (!Number.isFinite(userId) || userId <= 0) {
      // Pas authentifié — laisse le handler renvoyer 401.
      return handler(req, ctx)
    }

    // Lit le body brut pour hash. NextRequest.clone() permet de re-lire après.
    // Acceptable car routes PATCH/POST petites (≤ 50 KB).
    let rawBody = ""
    try {
      rawBody = await req.clone().text()
    } catch {
      // body unreadable → handler gérera l'erreur.
      return handler(req, ctx)
    }
    const bodyHash = hashBody(rawBody)

    const lookup = await idempotencyService.lookup(idemKey, userId, bodyHash)

    if (lookup.type === "mismatch") {
      logger.warn("idempotency", "key reused with different body", {
        kind: "idem.mismatch",
        action: options.route,
        userId,
        key: idemKey.slice(0, 8) + "…",
      })
      return NextResponse.json(
        {
          error: "idempotencyMismatch",
          message: "La clé Idempotency-Key a déjà été utilisée avec un corps différent.",
        },
        { status: 409 },
      )
    }

    if (lookup.type === "replay") {
      // Renvoie la response cachée. Le handler n'est PAS appelé → pas de
      // side-effect backend (re-PATCH évité, re-audit évité).
      return new NextResponse(lookup.body, {
        status: lookup.status,
        headers: {
          "Content-Type": lookup.contentType,
          [IDEMPOTENCY_REPLAYED_HEADER]: "true",
        },
      })
    }

    // miss → exécute le handler puis cache la response.
    const response = await handler(req, ctx)

    // Ne cache que les responses "finales" du serveur (2xx/4xx). Pas les 5xx
    // (transient errors — client retry doit pouvoir re-tenter).
    if (response.status >= 500) {
      return response
    }

    try {
      const cloned = response.clone()
      const responseBody = await cloned.text()
      const contentType = response.headers.get("content-type") ?? "application/json"
      await idempotencyService.store(
        {
          key: idemKey,
          bodyHash,
          status: response.status,
          body: responseBody,
          contentType,
        },
        userId,
      )
    } catch (err) {
      logger.warn("idempotency", "failed to cache response (fail-open)", {
        kind: "idem.cache.failed",
        action: options.route,
        failMode: err instanceof Error ? err.message : String(err),
      })
    }

    return response
  }
}
