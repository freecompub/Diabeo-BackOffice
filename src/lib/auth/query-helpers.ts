/**
 * @module query-helpers
 * @description Shared parsers for common query parameters on API routes.
 * Centralizes Zod validation so each route doesn't reimplement int parsing
 * and NaN-handling for `?patientId=`.
 */

import { z } from "zod"
import { resolvePatientId } from "@/lib/access-control"
import type { Role } from "@prisma/client"

const patientIdSchema = z.coerce.number().int().positive().optional()

/**
 * Parse and resolve `?patientId=N` from a request URL, delegating RBAC to
 * `resolvePatientId` (VIEWER → own; pros → `canAccessPatient`).
 *
 * Returns:
 * - `{ patientId: number }` when resolved (200 path)
 * - `{ error: "invalidPatientId" }` when the query param is present but malformed (400)
 * - `{ error: "patientNotFound" }` when access is denied or no patient exists (404)
 */
export async function resolvePatientIdFromQuery(
  req: Request,
  userId: number,
  role: Role,
): Promise<
  | { patientId: number; error?: undefined }
  | { error: "invalidPatientId" | "patientNotFound"; patientId?: undefined }
> {
  const raw = new URL(req.url).searchParams.get("patientId")
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
