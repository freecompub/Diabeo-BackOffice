import { prisma } from "@/lib/db/client"
import type { Role } from "@prisma/client"

/**
 * Check if a user can access a given patient's data.
 * - ADMIN: access to all non-deleted patients
 * - DOCTOR/NURSE: only patients linked to their healthcare service
 * - VIEWER: own patient record only (via userId match)
 *
 * Always filters out soft-deleted patients.
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
    return patient !== null
  }

  // VIEWER (patient role) — can only access own record
  if (role === "VIEWER") {
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, userId, deletedAt: null },
      select: { id: true },
    })
    return patient !== null
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
  return link !== null
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
