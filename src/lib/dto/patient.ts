/**
 * Shared DTO for the patient list endpoint (`GET /api/patients`).
 *
 * Both the VIEWER branch (own patient) and the NURSE+/DOCTOR+/ADMIN branch
 * (portfolio via PatientReferent) MUST return this exact shape so the frontend
 * can consume one stable contract. The service layer maps the underlying Prisma
 * result down to this DTO — adding a field here is the single point of change.
 *
 * IMPORTANT: keep this surface minimal. The list endpoint shows enough to
 * identify a patient and route to their detail page; rich PHI (medical data,
 * objectives, devices…) belongs to the per-patient endpoints, not the list.
 * RGPD Art. 5 data minimisation.
 */

import type { Pathology } from "@prisma/client"

/**
 * One row of the patient list. `name` fields are already decrypted (the service
 * applies `safeDecrypt` before returning). `birthday` is serialized as ISO
 * string after JSON round-trip — the frontend computes age from it.
 */
export interface PatientListItemDto {
  id: number
  pathology: Pathology
  user: {
    id: number
    firstname: string | null
    lastname: string | null
    /** ISO date string after JSON serialization (Prisma DateTime → string). */
    birthday: string | null
  }
}
