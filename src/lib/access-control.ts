/**
 * @module access-control
 * @description Patient access control — RBAC enforcement by role.
 * - ADMIN : unrestricted (bypass PHI — risque V1 accepté, levé en V4 / F1).
 * - DOCTOR : **isolé par médecin référent** (US-2618/F6) — un médecin ne voit
 *   QUE ses patients (`PatientReferent.pro.userId`), pas tous ceux du service.
 *   Responsable de traitement RGPD : médecins = contrôleurs distincts.
 * - NURSE : **périmètre service** (`PatientService → HealthcareService.members`) —
 *   l'infirmier assiste les médecins de son/ses service(s) (workflow préservé V1).
 * - VIEWER : propre dossier uniquement.
 * Exclut toujours les patients soft-deleted.
 * @see CLAUDE.md#rbac — Role-based access control
 */

import { prisma } from "@/lib/db/client"
import type { Role } from "@prisma/client"

/**
 * Borne de sécurité sur le périmètre cross-patient (anti-OOM + parité avec
 * `LIST_BY_DOCTOR_MAX` de patient.service). Au-delà, l'IN-list devient énorme ;
 * les consommateurs (dashboards/cohortes) devront paginer. Cap volontairement
 * généreux : un portefeuille > 5000 patients est un cabinet atypique.
 */
const ACCESSIBLE_IDS_MAX = 5000

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

  // DOCTOR — F6 : isolé par médecin référent (PatientReferent.pro.userId).
  if (role === "DOCTOR") {
    const ref = await prisma.patientReferent.findFirst({
      where: { patientId, patient: { deletedAt: null }, pro: { userId } },
      select: { id: true },
    })
    return !!ref
  }

  // NURSE (rôle clinique non-DOCTOR) — périmètre service (inchangé) :
  // PatientService → HealthcareService → HealthcareMember.
  const link = await prisma.patientService.findFirst({
    where: {
      patientId,
      patient: { deletedAt: null },
      service: {
        members: { some: { userId } },
      },
    },
    select: { id: true },
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

/**
 * Resolve the list of patient IDs the caller can access (RBAC scoping for
 * cross-patient queries like inboxes/dashboards).
 *
 * - ADMIN → returns null (caller may query without restriction).
 * - VIEWER → returns [own patient id] or [] if none.
 * - DOCTOR → **referent-scoped** (US-2618/F6) : patient IDs where the caller is
 *   the médecin référent (`PatientReferent.pro.userId`), soft-deleted excluded.
 * - NURSE → **service-scoped** (unchanged) : patient IDs of every PatientService
 *   whose HealthcareService has the caller as a member.
 *
 * The caller MUST treat `null` as "no restriction" and an array as a hard
 * IN-list filter (empty array → no rows).
 */
export async function getAccessiblePatientIds(
  userId: number,
  role: Role,
): Promise<number[] | null> {
  if (role === "ADMIN") return null

  if (role === "VIEWER") {
    const own = await getOwnPatientId(userId)
    return own ? [own] : []
  }

  // DOCTOR — F6 : périmètre référent (un patient = un référent, pas de distinct).
  if (role === "DOCTOR") {
    const refs = await prisma.patientReferent.findMany({
      where: { patient: { deletedAt: null }, pro: { userId } },
      select: { patientId: true },
      take: ACCESSIBLE_IDS_MAX,
    })
    return refs.map((r) => r.patientId)
  }

  // NURSE — périmètre service (inchangé).
  const links = await prisma.patientService.findMany({
    where: {
      patient: { deletedAt: null },
      service: {
        members: { some: { userId } },
      },
    },
    select: { patientId: true },
    distinct: ["patientId"],
    take: ACCESSIBLE_IDS_MAX,
  })
  return links.map((l) => l.patientId)
}

/**
 * Anti-énumération unifié : résout `(patient existe, RBAC OK, consent OK)`
 * derrière un seul code-retour neutre `null` pour les non-autorisés.
 *
 * Le rationale (PR #415 review round 2 — HIGH-2 healthcare-security-auditor) :
 * les routes patient/[id]/* ne doivent JAMAIS distinguer publiquement
 *   - "patient n'existe pas" (404)
 *   - "patient existe sans consent" (403 gdprConsentRequired)
 *   - "patient existe, consent OK, mais RBAC denied" (403 forbidden)
 *
 * Sinon un VIEWER ou NURSE hors-cabinet peut énumérer (a) les patient IDs
 * valides, (b) leur statut consent RGPD, en O(n) requêtes sur le parc.
 *
 * Ordre canonique (cf. `/api/patients/[id]/cgm/route.ts:31-42`) :
 *   1. `canAccessPatient` → si false, retour null + audit accessDenied
 *      (US-2265 burst detection sur tentatives d'énumération)
 *   2. `patient.findFirst(deletedAt: null)` → résolution `userId` du data subject
 *   3. `requireGdprConsent(patient.userId)` → consent du data subject (CR H4)
 *
 * Retour :
 *   - `null` si une étape échoue (le caller doit retourner 403 forbidden
 *     uniforme — pas de discrimination publique)
 *   - `{ patientId, ownerUserId }` si toutes les étapes passent
 *
 * @internal Le module audit-service est résolu lazy pour éviter circular dep.
 */
export interface ResolvedPatient {
  patientId: number
  ownerUserId: number
}

export async function resolvePatientForConsent(
  callerUserId: number,
  callerRole: Role,
  patientId: number,
  audit: {
    onAccessDenied: () => Promise<void> | void
  },
): Promise<ResolvedPatient | null> {
  // Étape 1 — RBAC AVANT toute lecture (anti-énumération).
  const allowed = await canAccessPatient(callerUserId, callerRole, patientId)
  if (!allowed) {
    await audit.onAccessDenied()
    return null
  }

  // Étape 2 — résolution data subject (post-RBAC OK).
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, deletedAt: null },
    select: { userId: true },
  })
  if (!patient) {
    // canAccessPatient vient de retourner true mais Patient soft-delete entre
    // les deux queries → TOCTOU race rare. Sécurité : 403 uniforme.
    return null
  }

  // Étape 3 — consent du data subject (CR H4 RGPD Art. 9).
  const { requireGdprConsent } = await import("@/lib/gdpr")
  const hasConsent = await requireGdprConsent(patient.userId)
  if (!hasConsent) return null

  return { patientId, ownerUserId: patient.userId }
}
