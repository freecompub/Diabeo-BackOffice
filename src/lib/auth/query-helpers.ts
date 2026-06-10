/**
 * @module query-helpers
 * @description Shared parsers for common query parameters on API routes.
 * Centralizes Zod validation so each route doesn't reimplement int parsing
 * and NaN-handling for `?patientId=`.
 */

import { z } from "zod"
import type { NextRequest } from "next/server"
import { resolvePatientId } from "@/lib/access-control"
import { resolveConsultation } from "@/lib/services/consultation.service"
import type { Role } from "@prisma/client"

// Re-export pour les appelants serveur historiques. La constante VIT dans un
// module client-safe isolé (`./consultation-token`) pour éviter de tirer ce
// module serveur (Prisma/Redis) dans le bundle navigateur via les composants.
export { CONSULTATION_TOKEN_HEADER } from "./consultation-token"
import { CONSULTATION_TOKEN_HEADER } from "./consultation-token"

const patientIdSchema = z.coerce.number().int().positive().optional()

/**
 * Resolve the patient targeted by a request. Resolution order:
 *
 * 1. **Consultation token** (`x-consultation-token`) — US-2018b pro path: the
 *    patient opened in the ephemeral overlay, **with no id in the URL**. The
 *    token is bound to the caller (anti-share); invalid/expired → neutral 404.
 *    Folding it here means every patient-scoped route that already uses this
 *    helper (analytics, cgm, /api/patient…) becomes token-aware with no change.
 *    Safe: a token only ever resolves to a patient the caller can already
 *    access (validated at `consultation/open` via `canAccessPatient`).
 * 2. Otherwise **`?patientId=N`** — historical path (VIEWER → own; pros with an
 *    explicit param → `canAccessPatient`).
 *
 * Returns:
 * - `{ patientId: number }` when resolved (200 path)
 * - `{ error: "invalidPatientId" }` when `?patientId` is present but malformed (400)
 * - `{ error: "patientNotFound" }` when access is denied / no patient / bad token (404)
 */
export async function resolvePatientIdFromQuery(
  req: NextRequest,
  userId: number,
  role: Role,
): Promise<
  | { patientId: number; error?: undefined }
  | { error: "invalidPatientId" | "patientNotFound"; patientId?: undefined }
> {
  // 1. Ephemeral consultation token (pro workspace, no id in URL) — READ-ONLY.
  //    H1 (review) — the token is a read credential for the consultation
  //    overlay ; it must NOT widen its scope to mutations. Honor it only on GET.
  //    Writes (POST/PUT/PATCH/DELETE) fall through to the explicit ?patientId
  //    path, which is gated by canAccessPatient on every mutation route.
  const cTok = req.headers.get(CONSULTATION_TOKEN_HEADER)
  if (cTok && req.method === "GET") {
    const patientId = await resolveConsultation(cTok, userId)
    if (!patientId) return { error: "patientNotFound" }
    return { patientId }
  }

  // 2. Explicit ?patientId (or VIEWER own).
  const raw = req.nextUrl.searchParams.get("patientId")
  const parsed = patientIdSchema.safeParse(raw ?? undefined)
  if (!parsed.success) {
    return { error: "invalidPatientId" }
  }

  const patientId = await resolvePatientId(userId, role, parsed.data)
  if (!patientId) {
    return { error: "patientNotFound" }
  }
  return { patientId }
}
