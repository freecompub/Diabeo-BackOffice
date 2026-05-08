/**
 * @module mobile-invitation.service
 * @description US-2025 — Génération d'une invitation mobile QR code pour un patient.
 *
 * Le pro génère un token court (JWT 24h, audience `diabeo-patient-invite`) que
 * le patient scanne via son app iOS. Le QR contient un deep link
 * `diabeo://invite/{token}` ou un fallback HTTPS.
 *
 * **Single-use** : la consommation du token (côté API redeem, hors scope MVP)
 * doit enregistrer le `jti` dans une table de tokens consommés pour empêcher
 * la réutilisation. Tant que cette table n'existe pas, le token est replay-safe
 * uniquement par expiration courte (24h).
 *
 * **PHI** : ne loggue jamais le token ni l'URL en clair (audit metadata =
 * `{patientId, jti, expiresAt}`).
 */

import { prisma } from "@/lib/db/client"
import { signPatientInviteToken } from "@/lib/auth/jwt"
import { auditService } from "./audit.service"
import { canAccessPatient } from "@/lib/access-control"
import type { AuditContext } from "./audit.service"
import type { Role } from "@prisma/client"

/** Base URL pour les deep links — fallback HTTPS si l'app n'est pas installée. */
const DEFAULT_INVITE_HOST = "https://app.diabeo.fr"

interface CreateInviteInput {
  patientId: number
  invitedBy: number
  invitedByRole: Role
}

export interface InviteResult {
  /** Token JWT signé (à intégrer dans le QR). NE PAS LOGGER. */
  token: string
  /** Deep link iOS — l'app intercepte ce schéma. */
  deepLink: string
  /** URL HTTPS de fallback (si l'app n'est pas installée). */
  fallbackUrl: string
  /** Expiration absolue du token. */
  expiresAt: Date
}

export const mobileInvitationService = {
  /**
   * Génère un token d'invitation pour un patient. Le caller doit avoir le
   * droit d'accéder au patient (vérifié ici en defense-in-depth).
   *
   * @returns Token + URLs deep link et fallback. Audit `CREATE` enregistré.
   */
  async createInvite(
    input: CreateInviteInput,
    ctx?: AuditContext,
  ): Promise<InviteResult> {
    // Vérifier que le patient existe et est accessible (anti-oracle).
    const patient = await prisma.patient.findFirst({
      where: { id: input.patientId, deletedAt: null },
      select: { id: true },
    })
    if (!patient) throw new Error("patient_not_found")

    const allowed = await canAccessPatient(
      input.invitedBy,
      input.invitedByRole,
      input.patientId,
    )
    if (!allowed) throw new Error("forbidden")

    const { token, jti, expiresAt } = await signPatientInviteToken({
      patientId: input.patientId,
      invitedBy: input.invitedBy,
    })

    const host = process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_INVITE_HOST
    const deepLink = `diabeo://invite/${encodeURIComponent(token)}`
    const fallbackUrl = `${host}/invite/${encodeURIComponent(token)}`

    // Audit CREATE — `jti` est l'identifiant opaque du token (non-PHI).
    // On stocke `expiresAt` ISO (forensique : "qui a généré quoi quand").
    await auditService.log({
      userId: input.invitedBy,
      action: "CREATE",
      resource: "PATIENT",
      resourceId: `${input.patientId}:invite:${jti}`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { jti, expiresAt: expiresAt.toISOString() },
    })

    return { token, deepLink, fallbackUrl, expiresAt }
  },
}
