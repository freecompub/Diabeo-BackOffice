import { prisma } from "@/lib/db/client"
import type { Role } from "@prisma/client"

/**
 * Check if a user can access a given patient's data.
 * - ADMIN: access to all non-deleted patients
 * - DOCTOR/NURSE: only patients linked to their healthcare service
 * - VIEWER: own patient record only (via userId match)
 *
 * Always filters out soft-deleted patients.
 * Uses loose equality (!=) to handle both null and undefined from Prisma.
 */
export async function canAccessPatient(
  userId: number,
  role: Role,
  patientId: number,
): Promise<boolean> {
  if (role === "ADMIN") {
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: { id: true },
    })
    return !!patient
  }

  // VIEWER (patient role) — can only access own record
  if (role === "VIEWER") {
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, userId, deletedAt: null },
      select: { id: true },
    })
    return !!patient
  }

  // DOCTOR / NURSE — check via PatientService → HealthcareService → HealthcareMember
  const link = await prisma.patientService.findFirst({
    where: {
      patientId,
      patient: { deletedAt: null },
      service: {
        members: { some: { userId } },
      },
    },
  })
  return !!link
}

/**
 * Get the patient ID for the currently authenticated user.
 * Returns null if the user is not a patient or patient is soft-deleted.
 */
export async function getOwnPatientId(userId: number): Promise<number | null> {
  const patient = await prisma.patient.findFirst({
    where: { userId, deletedAt: null },
    select: { id: true },
  })
  return patient?.id ?? null
}

/**
 * Resolve patient ID from request: either own patient (VIEWER) or explicit patientId param (pro).
 * For VIEWER: returns own patient ID.
 * For DOCTOR/NURSE/ADMIN: requires patientId param and validates access.
 * Returns null if access denied or patient not found.
 */
export async function resolvePatientId(
  userId: number,
  role: Role,
  patientIdParam?: number,
): Promise<number | null> {
  // VIEWER — always own patient, ignore patientId param
  if (role === "VIEWER") {
    return getOwnPatientId(userId)
  }

  // Pro roles — require explicit patientId
  if (!patientIdParam) return null

  const allowed = await canAccessPatient(userId, role, patientIdParam)
  return allowed ? patientIdParam : null
}
