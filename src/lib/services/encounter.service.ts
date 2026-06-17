/**
 * @module encounter.service
 * @description US-2605 — Mode revue de consultation (sans IA).
 *
 * Une `Encounter` est une séance de revue ouverte par un PS sur un patient.
 * `openOrResume` reprend le brouillon du jour (TZ cabinet) pour (patient, PS) ou
 * en crée un. Le brouillon de compte rendu est conservé en cas d'interruption.
 * `finalizeReport` émet un `ConsultationReportAddendum` **immuable** (append-only,
 * trigger PG) ancré sur la version des données (`period` + `dataAsOf`).
 *
 * Sécurité : accès vérifié par `canAccessPatient` (défense en profondeur, les
 * routes gardent aussi RBAC) ; contenus chiffrés AES-256-GCM (`@/lib/crypto/fields`) ;
 * accès audité (pivot `metadata.patientId`, ADR #18).
 */

import type { Role } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { startOfTodayCabinet } from "@/lib/cabinet-time"

/** Erreur typée → mappée en statut HTTP par les routes. */
export class EncounterError extends Error {
  constructor(public code: "forbidden" | "notFound" | "invalidState") {
    super(code)
    this.name = "EncounterError"
  }
}

/** Statut HTTP correspondant à un code `EncounterError` (mapping route). */
export function encounterErrorStatus(code: EncounterError["code"]): number {
  return code === "forbidden" ? 403 : code === "notFound" ? 404 : 409
}

/**
 * Trace SOC d'un refus d'accès sur une séance (UNAUTHORIZED + détection de burst
 * US-2265). Pivot `metadata.patientId` (ADR #18). `surface` = l'opération tentée,
 * `kind` = le motif du refus (notOwner / accessRevoked / sharingDisabled).
 */
async function auditEncounterDenied(args: {
  userId: number
  encounterId: number
  patientId: number
  surface: "saveDraft" | "finalize"
  kind: "notOwner" | "accessRevoked" | "sharingDisabled"
  ctx?: AuditContext
}): Promise<void> {
  await auditService.accessDenied({
    userId: args.userId,
    resource: "ENCOUNTER",
    resourceId: String(args.encounterId),
    ipAddress: args.ctx?.ipAddress,
    userAgent: args.ctx?.userAgent,
    requestId: args.ctx?.requestId,
    metadata: { patientId: args.patientId, surface: args.surface, kind: args.kind },
  })
}

export type EncounterDraft = {
  id: number
  patientId: number
  status: "draft" | "completed" | "abandoned"
  draftReport: string | null
  period: string | null
  dataAsOf: string | null
  openedAt: string
}

export type ReportItem = {
  id: number
  encounterId: number
  content: string | null
  period: string
  dataAsOf: string
  createdAt: string
}

export const encounterService = {
  /**
   * Reprend la séance de revue brouillon du jour (TZ cabinet) pour (patient, PS),
   * ou en crée une. Idempotent même jour. Audite ENCOUNTER (READ resume / CREATE).
   */
  async openOrResume(
    patientId: number, userId: number, role: Role, ctx?: AuditContext,
  ): Promise<EncounterDraft> {
    if (!(await canAccessPatient(userId, role, patientId))) {
      throw new EncounterError("forbidden")
    }

    const existing = await prisma.encounter.findFirst({
      where: {
        patientId,
        openedById: userId,
        status: "draft",
        openedAt: { gte: startOfTodayCabinet() },
      },
      orderBy: { openedAt: "desc" },
    })

    const enc = existing ?? (await prisma.encounter.create({ data: { patientId, openedById: userId } }))

    await auditService.log({
      userId, action: existing ? "READ" : "CREATE", resource: "ENCOUNTER",
      resourceId: String(enc.id),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: existing ? "resume" : "open" },
    })

    return {
      id: enc.id,
      patientId: enc.patientId,
      status: enc.status,
      draftReport: safeDecryptField(enc.draftReportEnc),
      period: enc.period,
      dataAsOf: enc.dataAsOf ? enc.dataAsOf.toISOString() : null,
      openedAt: enc.openedAt.toISOString(),
    }
  },

  /**
   * Sauvegarde le brouillon de compte rendu (chiffré). Réservé au propriétaire
   * de la séance, tant qu'elle est en brouillon.
   */
  async saveDraft(
    encounterId: number, userId: number, role: Role, content: string, ctx?: AuditContext,
  ): Promise<void> {
    const enc = await prisma.encounter.findUnique({ where: { id: encounterId } })
    if (!enc) throw new EncounterError("notFound")
    if (enc.openedById !== userId) {
      await auditEncounterDenied({ userId, encounterId, patientId: enc.patientId, surface: "saveDraft", kind: "notOwner", ctx })
      throw new EncounterError("forbidden")
    }
    // Re-vérifie l'accès patient (RGPD Art. 7.3) : une séance peut être longue —
    // l'accès a pu être révoqué (désassignation / retrait de partage) depuis
    // l'ouverture. Fail-closed : pas d'écriture sur un patient devenu hors périmètre.
    if (!(await canAccessPatient(userId, role, enc.patientId))) {
      await auditEncounterDenied({ userId, encounterId, patientId: enc.patientId, surface: "saveDraft", kind: "accessRevoked", ctx })
      throw new EncounterError("forbidden")
    }
    if (enc.status !== "draft") throw new EncounterError("invalidState")

    await prisma.encounter.update({
      where: { id: encounterId },
      // Un brouillon vide remet la colonne à NULL plutôt que d'y stocker le
      // chiffré d'une chaîne vide (cohérence avec « pas de brouillon »).
      data: { draftReportEnc: content ? encryptField(content) : null },
    })
    await auditService.log({
      userId, action: "UPDATE", resource: "ENCOUNTER", resourceId: String(encounterId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId: enc.patientId, kind: "draftSaved" },
    })
  },

  /**
   * Finalise le compte rendu : émet un addendum IMMUABLE (ancré `period`/`dataAsOf`),
   * clôt la séance (`completed`), vide le brouillon — le tout atomiquement + audité.
   * Réservé au propriétaire de la séance en brouillon (RBAC NURSE+ côté route).
   */
  async finalizeReport(
    encounterId: number, userId: number, role: Role,
    content: string, anchor: { period: string; dataAsOf: Date },
    ctx?: AuditContext,
  ): Promise<{ reportId: number; patientId: number }> {
    // Un compte rendu finalisé est un acte médical immuable : refuser le vide
    // (le contenu est requis NOT NULL ; un addendum vide n'aurait aucun sens).
    if (!content.trim()) throw new EncounterError("invalidState")

    const enc = await prisma.encounter.findUnique({ where: { id: encounterId } })
    if (!enc) throw new EncounterError("notFound")
    if (enc.openedById !== userId) {
      await auditEncounterDenied({ userId, encounterId, patientId: enc.patientId, surface: "finalize", kind: "notOwner", ctx })
      throw new EncounterError("forbidden")
    }
    // Re-vérifie l'accès AVANT d'émettre l'addendum IMMUABLE (révocation possible
    // pendant une séance longue, RGPD Art. 7.3). Fail-closed.
    if (!(await canAccessPatient(userId, role, enc.patientId))) {
      await auditEncounterDenied({ userId, encounterId, patientId: enc.patientId, surface: "finalize", kind: "accessRevoked", ctx })
      throw new EncounterError("forbidden")
    }
    // Garde consentement (gdprConsent + shareWithProviders, fail-closed) — un
    // compte rendu immuable ne doit pas être figé pour un patient ayant retiré
    // son partage entre l'ouverture et la finalisation.
    if (!(await patientShareConsent(enc.patientId)).ok) {
      await auditEncounterDenied({ userId, encounterId, patientId: enc.patientId, surface: "finalize", kind: "sharingDisabled", ctx })
      throw new EncounterError("forbidden")
    }
    if (enc.status !== "draft") throw new EncounterError("invalidState")

    return prisma.$transaction(async (tx) => {
      const report = await tx.consultationReportAddendum.create({
        data: {
          encounterId,
          patientId: enc.patientId,
          authorId: userId,
          content: encryptField(content),
          period: anchor.period,
          dataAsOf: anchor.dataAsOf,
        },
      })
      await tx.encounter.update({
        where: { id: encounterId },
        data: { status: "completed", closedAt: new Date(), draftReportEnc: null },
      })
      await auditService.logWithTx(tx, {
        userId, action: "CREATE", resource: "CONSULTATION_REPORT", resourceId: String(report.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: enc.patientId, encounterId, period: anchor.period, dataAsOf: anchor.dataAsOf.toISOString() },
      })
      await auditService.logWithTx(tx, {
        userId, action: "UPDATE", resource: "ENCOUNTER", resourceId: String(encounterId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: enc.patientId, kind: "finalized" },
      })
      return { reportId: report.id, patientId: enc.patientId }
    })
  },

  /**
   * Liste les comptes rendus finalisés (non soft-deleted) d'un patient.
   * Accès vérifié par `canAccessPatient` (défense en profondeur, en plus du RBAC
   * de la route). Déchiffrement serveur fail-soft (contenu corrompu → null).
   */
  async listReports(
    patientId: number, userId: number, role: Role, ctx?: AuditContext,
  ): Promise<ReportItem[]> {
    if (!(await canAccessPatient(userId, role, patientId))) {
      throw new EncounterError("forbidden")
    }

    const rows = await prisma.consultationReportAddendum.findMany({
      where: { patientId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    })
    await auditService.log({
      userId, action: "READ", resource: "CONSULTATION_REPORT", resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, count: rows.length },
    })
    return rows.map((r) => ({
      id: r.id,
      encounterId: r.encounterId,
      content: safeDecryptField(r.content),
      period: r.period,
      dataAsOf: r.dataAsOf.toISOString(),
      createdAt: r.createdAt.toISOString(),
    }))
  },
}
