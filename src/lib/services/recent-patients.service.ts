/**
 * @module recent-patients.service
 * @description US-2603 — switcher de contexte patient : dossiers récemment vus
 * et épinglés, par PS.
 *
 * Sécurité (HDS/RGPD) :
 *  - **Scope dur à la lecture** : `listRecentAndPinned` intersecte TOUJOURS les
 *    entrées avec `getAccessiblePatientIds` (+ `deletedAt: null`). Un patient
 *    sorti du périmètre du PS (ou soft-deleted) disparaît silencieusement, même
 *    s'il avait été épinglé → aucune fuite hors périmètre.
 *  - Les noms renvoyés sont de la PII : déchiffrement **serveur**
 *    (`safeDecryptField`), endpoint `no-store`, accès **audité** (résumé + pivots
 *    `metadata.patientId`, ADR #18).
 *  - `recordView` n'écrit que des métadonnées de navigation (userId/patientId/
 *    timestamp, aucune PHI) ; la consultation elle-même est auditée par
 *    `patientService.getById` (READ PATIENT) → pas d'audit dédié ici (anti-bruit).
 *  - L'accès patient pour `pin`/`unpin` est vérifié par la route appelante
 *    (`canAccessPatient` → `accessDenied` + 403 uniforme).
 */

import type { Role } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { getAccessiblePatientIds } from "@/lib/access-control"
import { auditService, type AuditContext } from "./audit.service"
import { safeDecryptField } from "@/lib/crypto/fields"

/** Référence patient minimale pour le switcher (PII déchiffrée serveur). */
export type PatientRef = {
  id: number
  publicRef: string
  name: string
  pathology: string | null
}

/** Nombre max de « récemment vus » renvoyés. */
const RECENT_LIMIT = 10
/** Plafond défensif d'épingles par PS. */
const PINNED_CAP = 20

type PatientSelectRow = {
  patient: {
    id: number
    publicRef: string
    pathology: string | null
    user: { firstname: string | null; lastname: string | null }
  }
}

const PATIENT_SELECT = {
  patient: {
    select: {
      id: true,
      publicRef: true,
      pathology: true,
      user: { select: { firstname: true, lastname: true } },
    },
  },
} as const

function toRef(row: PatientSelectRow): PatientRef {
  const p = row.patient
  const name = `${safeDecryptField(p.user.firstname ?? "") ?? ""} ${safeDecryptField(p.user.lastname ?? "") ?? ""}`.trim()
  return { id: p.id, publicRef: p.publicRef, name, pathology: p.pathology }
}

export const recentPatientsService = {
  /**
   * Enregistre/rafraîchit la consultation d'un dossier par un PS (upsert →
   * `viewedAt = now()`). Idempotent par (user, patient). Aucune PHI ; pas d'audit
   * dédié (la consultation est auditée par getById). Doit être appelé fail-soft.
   */
  async recordView(userId: number, patientId: number): Promise<void> {
    await prisma.recentlyViewedPatient.upsert({
      where: { userId_patientId: { userId, patientId } },
      create: { userId, patientId },
      update: { viewedAt: new Date() },
    })
  },

  /**
   * Liste les récemment vus + épinglés du PS, **scopés au périmètre** (anti-fuite)
   * et hors patients soft-deleted. Déchiffre les noms serveur + audite.
   */
  async listRecentAndPinned(
    userId: number, role: Role,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<{ recent: PatientRef[]; pinned: PatientRef[] }> {
    const accessible = await getAccessiblePatientIds(userId, role)
    // Portefeuille vide (DOCTOR/NURSE sans patient) → rien.
    if (accessible !== null && accessible.length === 0) return { recent: [], pinned: [] }
    // ADMIN (null) = pas de restriction d'IDs ; sinon intersection dure.
    const scope = accessible === null ? {} : { patientId: { in: accessible } }

    const [recentRows, pinnedRows] = await Promise.all([
      prisma.recentlyViewedPatient.findMany({
        where: { userId, ...scope, patient: { deletedAt: null } },
        orderBy: { viewedAt: "desc" },
        take: RECENT_LIMIT,
        select: PATIENT_SELECT,
      }),
      prisma.pinnedPatient.findMany({
        where: { userId, ...scope, patient: { deletedAt: null } },
        orderBy: { pinnedAt: "desc" },
        take: PINNED_CAP,
        select: PATIENT_SELECT,
      }),
    ])

    const recent = recentRows.map(toRef)
    const pinned = pinnedRows.map(toRef)

    // Audit : résumé + pivots per-patient (noms = PII). allSettled : un échec
    // d'audit ne casse pas le switcher après calcul.
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT", resourceId: "list",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "patient.switcher", recent: recent.length, pinned: pinned.length },
    })
    const pivotIds = new Set([...recent, ...pinned].map((p) => p.id))
    await Promise.allSettled(
      [...pivotIds].map((id) =>
        auditService.log({
          userId: auditUserId, action: "READ", resource: "PATIENT", resourceId: String(id),
          ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
          metadata: { patientId: id, kind: "patient.switcher" },
        }),
      ),
    )

    return { recent, pinned }
  },

  /**
   * Épingle un patient pour le PS. Plafonné à {@link PINNED_CAP}. L'accès patient
   * est vérifié par la route appelante. Retourne `{ ok: false }` si plafond atteint.
   */
  async pin(
    userId: number, patientId: number,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<{ ok: true } | { ok: false; reason: "pinnedLimitReached" }> {
    const already = await prisma.pinnedPatient.findUnique({
      where: { userId_patientId: { userId, patientId } },
      select: { id: true },
    })
    if (!already) {
      // Check-then-write non atomique : 2 épinglages concourants du MÊME PS
      // pourraient dépasser le plafond de +1. Course bénigne (mono-acteur,
      // plafond purement défensif) — pas de transaction pour cette borne souple.
      const count = await prisma.pinnedPatient.count({ where: { userId } })
      if (count >= PINNED_CAP) return { ok: false, reason: "pinnedLimitReached" }
    }
    await prisma.pinnedPatient.upsert({
      where: { userId_patientId: { userId, patientId } },
      create: { userId, patientId },
      update: {},
    })
    await auditService.log({
      userId: auditUserId, action: "CREATE", resource: "PINNED_PATIENT", resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId },
    })
    return { ok: true }
  },

  /** Désépingle un patient pour le PS (idempotent). Accès vérifié par la route. */
  async unpin(
    userId: number, patientId: number,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<void> {
    await prisma.pinnedPatient.deleteMany({ where: { userId, patientId } })
    await auditService.log({
      userId: auditUserId, action: "DELETE", resource: "PINNED_PATIENT", resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId },
    })
  },
}
