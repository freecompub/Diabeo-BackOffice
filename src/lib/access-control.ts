import { prisma } from "@/lib/db/client"
import type { Role } from "@prisma/client"

/**
 * Check if a user can access a given patient's data.
 * - ADMIN: access to all patients
 * - DOCTOR/NURSE: only patients linked to their healthcare service
 * - VIEWER: own patient record only (via userId match)
 */
export async function canAccessPatient(
  userId: number,
  role: Role,
  patientId: number,
): Promise<boolean> {
  if (role === "ADMIN") return true

  // VIEWER (patient role) — can only access own record
  if (role === "VIEWER") {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { userId: true },
    })
    return patient?.userId === userId
  }

  // DOCTOR / NURSE — check via PatientService → HealthcareService → HealthcareMember
  const link = await prisma.patientService.findFirst({
    where: {
      patientId,
      service: {
        members: { some: { userId } },
      },
    },
  })
  return link !== null
}

/**
 * Get the patient ID for the currently authenticated user.
 * Returns null if the user is not a patient.
 */
export async function getOwnPatientId(userId: number): Promise<number | null> {
  const patient = await prisma.patient.findUnique({
    where: { userId },
    select: { id: true },
  })
  return patient?.id ?? null
}
