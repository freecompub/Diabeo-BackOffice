/**
 * @module access-control
 * @description Patient access control — RBAC enforcement by role and healthcare service links.
 * Prevents unauthorized data access. All patient reads should check access first.
 * ADMIN unrestricted, DOCTOR/NURSE via healthcare service, VIEWER = own patient only.
 * @see CLAUDE.md#rbac — Role-based access control
 */

import { prisma } from "@/lib/db/client"
import type { Role } from "@prisma/client"

/**
 * Check if a user can access a given patient's data — role-based access control.
 * - ADMIN: all non-deleted patients
 * - DOCTOR/NURSE: patients via healthcare service (PatientService → HealthcareService → HealthcareMember)
 * - VIEWER: own patient record only (User.patient link)
 * Always excludes soft-deleted patients.
 * @async
 * @param {number} userId - User ID to check
 * @param {Role} role - User role (ADMIN, DOCTOR, NURSE, VIEWER)
 * @param {number} patientId - Patient ID to access
 * @returns {Promise<boolean>} True if user can access patient, false otherwise
 * @example
 * const allowed = await canAccessPatient(userId, role, patientId)
 * if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
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
 * Get the patient ID for a user (if user is a patient).
 * Returns null if user has no patient record or patient is soft-deleted.
 * @async
 * @param {number} userId - User ID
 * @returns {Promise<number | null>} Patient ID or null
 */
export async function getOwnPatientId(userId: number): Promise<number | null> {
  const patient = await prisma.patient.findFirst({
    where: { userId, deletedAt: null },
    select: { id: true },
  })
  return patient?.id ?? null
}

/**
 * Resolve patient ID for request — handles VIEWER (own) vs PRO (explicit param) cases.
 * VIEWER always uses own patient, ignoring any patientId param.
 * PRO roles (DOCTOR/NURSE/ADMIN) require explicit patientId and access validation.
 * @async
 * @param {number} userId - User ID
 * @param {Role} role - User role (ADMIN, DOCTOR, NURSE, VIEWER)
 * @param {number} [patientIdParam] - Explicit patientId from request (required for pros)
 * @returns {Promise<number | null>} Resolved patientId or null if access denied
 * @example
 * // In API route handler
 * const patientId = await resolvePatientId(session.user.id, session.user.role, req.body.patientId)
 * if (!patientId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
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
