/**
 * @route /api/messages
 * @description US-2076 scope A — Messagerie sécurisée 1↔1.
 *   - GET : liste threads (inbox).
 *   - POST : envoie un message (encrypt + persist + FCM data-only).
 *
 * Auth : JWT requis (tout rôle, y compris VIEWER = patient).
 * Audit : `MESSAGE/READ` (inbox) ou `MESSAGE/CREATE` (send) avec pivot
 *         `metadata.patientId` (US-2268).
 * RBAC métier : `canMessage` côté service vérifie les liens
 *         patient↔PS (referent/PatientService) ou staff↔staff (cabinet).
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { extractRequestContext } from "@/lib/services/audit.service"
import {
  mapErrorToResponse,
  assertJsonContentType,
  assertBodySize,
} from "@/lib/team-route-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import {
  messagingService,
  MESSAGING_BOUNDS,
  MessagingValidationError,
  MessagingAccessError,
  MessagingRateLimitError,
} from "@/lib/services/messaging.service"

// Cap body : 4000 chars plaintext × ~4 bytes UTF-8 worst-case + base64/JSON
// overhead. 32 KB cap large mais safe.
const MAX_BODY_BYTES = 32_000

const sendSchema = z.object({
  toUserId: z.number().int().positive(),
  body: z.string().min(1).max(MESSAGING_BOUNDS.MAX_BODY_CHARS),
})

const listQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MESSAGING_BOUNDS.MAX_THREADS_PER_QUERY)
    .default(MESSAGING_BOUNDS.MAX_THREADS_PER_QUERY),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    // C1 (review) — Messagerie = données santé Art. 9 RGPD → consent obligatoire.
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const parsedQuery = listQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsedQuery.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const threads = await messagingService.listThreads(
      user.id,
      ctx,
      parsedQuery.data.limit,
    )
    return NextResponse.json({ items: threads })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "messages GET", ctx.requestId)
  }
}

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const ctErr = assertJsonContentType(req)
    if (ctErr) return ctErr
    const sizeErr = assertBodySize(req, MAX_BODY_BYTES)
    if (sizeErr) return sizeErr

    const user = requireAuth(req)
    // C1 (review) — Messagerie = données santé Art. 9 RGPD → consent obligatoire.
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }
    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: "invalidJSON" }, { status: 400 })
    }
    const parsed = sendSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    try {
      const result = await messagingService.send(user.id, parsed.data, ctx)
      return NextResponse.json({ message: result }, { status: 201 })
    } catch (e) {
      if (e instanceof MessagingValidationError) {
        return NextResponse.json(
          { error: "validationFailed", field: e.field, message: e.message },
          { status: 422 },
        )
      }
      if (e instanceof MessagingAccessError) {
        return NextResponse.json({ error: "forbidden", reason: e.reason }, { status: 403 })
      }
      if (e instanceof MessagingRateLimitError) {
        return NextResponse.json(
          { error: "rateLimitExceeded", retryAfterSeconds: e.retryAfterSeconds },
          {
            status: 429,
            headers: { "Retry-After": String(e.retryAfterSeconds) },
          },
        )
      }
      throw e
    }
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "messages POST", ctx.requestId)
  }
}
