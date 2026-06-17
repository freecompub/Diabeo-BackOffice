/**
 * @module ps-registration.service
 * @description US-2613 — Validation **manuelle** des preuves d'enregistrement PS
 * (back-office multi-pays). Réservé `SYSTEM_ADMIN` (= `ADMIN` V1 ; garde de rôle
 * portée par les routes).
 *
 * ⚠️ V1 — la vérification PS « réelle » (API RPPS, cycle de vie complet) est V4.
 * Ce service couvre le strict minimum demandé par US-2613 : lister les preuves
 * **en attente** (`unverified`) et **valider** (`verified`) / **refuser**
 * (`rejected`) — chaque décision tracée (`PS_PROOF_VALIDATED` / `PS_PROOF_REJECTED`).
 *
 * Le `SYSTEM_ADMIN` **n'octroie pas** la qualité PS « par décret » : il statue sur
 * une preuve déposée. Il ne fabrique pas une preuve qui n'existe pas.
 *
 * PII admin (identité du praticien) déchiffrée pour la revue — **jamais** de donnée
 * de santé (un PS n'a pas de dossier patient ici).
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import { safeDecryptField } from "@/lib/crypto/fields"

/** Erreur typée → mappée en statut HTTP par les routes. */
export class PsRegistrationError extends Error {
  constructor(public code: "notFound" | "invalidState") {
    super(code)
    this.name = "PsRegistrationError"
  }
}

export function psRegistrationErrorStatus(code: PsRegistrationError["code"]): number {
  return code === "notFound" ? 404 : 409
}

export type PsRegistrationView = {
  id: number
  userId: number
  firstname: string | null
  lastname: string | null
  email: string | null
  country: string
  scheme: string
  number: string | null
  method: string
  status: string
  createdAt: Date
}

export const psRegistrationService = {
  /** Liste les preuves PS **en attente** (statut `unverified`), plus ancienne d'abord. */
  async listPending(auditUserId: number, ctx?: AuditContext): Promise<PsRegistrationView[]> {
    const rows = await prisma.professionalRegistration.findMany({
      where: { status: "unverified" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, userId: true, country: true, scheme: true, number: true,
        method: true, status: true, createdAt: true,
        user: { select: { firstname: true, lastname: true, email: true } },
      },
    })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PROFESSIONAL_REGISTRATION",
      resourceId: "admin:ps-registrations:pending",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { count: rows.length },
    })

    return rows.map((r) => ({
      id: r.id, userId: r.userId,
      firstname: safeDecryptField(r.user.firstname),
      lastname: safeDecryptField(r.user.lastname),
      email: safeDecryptField(r.user.email),
      country: r.country, scheme: r.scheme, number: r.number,
      method: r.method, status: r.status, createdAt: r.createdAt,
    }))
  },

  /**
   * Statue sur une preuve PS en attente. `verified` ouvre l'éligibilité Q1 (selon
   * la politique) ; `rejected` ferme. Seules les preuves `unverified` sont
   * décidables (sinon `invalidState`).
   */
  async decide(
    registrationId: number,
    decision: "verified" | "rejected",
    auditUserId: number,
    ctx?: AuditContext,
    now: Date = new Date(),
  ): Promise<void> {
    const reg = await prisma.professionalRegistration.findUnique({
      where: { id: registrationId },
      select: { id: true, userId: true, status: true },
    })
    if (!reg) throw new PsRegistrationError("notFound")
    // Garde d'état rapide (UX) ; la garde **atomique** est dans la transaction.
    if (reg.status !== "unverified") throw new PsRegistrationError("invalidState")

    await prisma.$transaction(async (tx) => {
      // Anti-double-décision : `updateMany` avec garde `status = unverified` →
      // si une décision concurrente a déjà tranché entre le findUnique et ici,
      // `count = 0` → on annule (rollback, pas d'audit), au lieu d'écraser.
      const res = await tx.professionalRegistration.updateMany({
        where: { id: registrationId, status: "unverified" },
        data: { status: decision, verifiedById: auditUserId, verifiedAt: now },
      })
      if (res.count === 0) throw new PsRegistrationError("invalidState")

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: decision === "verified" ? "PS_PROOF_VALIDATED" : "PS_PROOF_REJECTED",
        resource: "PROFESSIONAL_REGISTRATION",
        resourceId: String(registrationId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { subjectUserId: reg.userId, decision },
      })
    })
  },
}
