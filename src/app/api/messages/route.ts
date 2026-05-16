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

// Cap HTTP body : MAX_BODY_BYTES_UTF8 (8164) × ~3 (JSON envelope worst-case
// escape + champs annexes) + 1KB headers. ~25 KB couvre largement.
// L5 review round 3 — réduit de 32K à 24K (alignement réel).
const MAX_BODY_BYTES = 24_000

const sendSchema = z.object({
  toUserId: z.number().int().positive(),
  // BLOCKER #1 fix (review round 3) — validation en octets UTF-8 (Buffer.byteLength)
  // alignée sur CHECK SQL `OCTET_LENGTH(body_encrypted) <= 8192`.
  // Le check codepoints/chars laissait passer 4000 emojis = 16028 octets → 500.
  body: z
    .string()
    .min(1)
    .superRefine((val, ctx) => {
      if (Buffer.byteLength(val, "utf8") > MESSAGING_BOUNDS.MAX_BODY_BYTES_UTF8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bodyTooLong",
          path: ["body"],
        })
      }
    }),
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
    // LOW review round 3 — anti-cache proxy intermédiaire (previews déchiffrés
    // = données santé). ANSSI RGS recommande `no-store` sur réponses sensibles.
    return NextResponse.json(
      { items: threads },
      { headers: { "Cache-Control": "no-store, private" } },
    )
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
      // NEW-M6 review round 4 — Normalisation : Zod fail = 422 (cohérent
      // avec MessagingValidationError service-side, body bien formé JSON
      // mais unprocessable). Évite divergence 400 (Zod) vs 422 (service).
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 422 },
      )
    }

    try {
      const result = await messagingService.send(user.id, parsed.data, ctx)
      return NextResponse.json(
        { message: result },
        {
          status: 201,
          headers: { "Cache-Control": "no-store, private" },
        },
      )
    } catch (e) {
      if (e instanceof MessagingValidationError) {
        return NextResponse.json(
          { error: "validationFailed", field: e.field, message: e.message },
          { status: 422 },
        )
      }
      if (e instanceof MessagingAccessError) {
        // NEW-H1 round 4 + CRITICAL-1 round 5 — Anti-énumération RGPD Art. 5(1)(f).
        // La raison `recipientConsentRevoked` ne doit JAMAIS être exposée
        // côté client (mapped → `forbidden` générique). Le service-side
        // émet un audit `accessDenied` (résource MESSAGE, kind
        // `message.send.recipientConsentRevoked`) AVANT le throw — la
        // forensique CNIL est ainsi préservée via audit_logs admin-only.
        const safeReason =
          e.reason === "recipientConsentRevoked" ? "forbidden" : e.reason
        return NextResponse.json(
          { error: "forbidden", reason: safeReason },
          { status: 403 },
        )
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
