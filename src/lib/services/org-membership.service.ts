/**
 * @module org-membership.service
 * @description US-2610 — Gestion du personnel & des droits d'un cabinet (service).
 *
 * Modèle 2 axes (cf. `capabilities.ts`) : **Q1 clinique** (`clinicalRole`, accès PHI)
 * et **Q2 gestion** (`canManage` opérationnel / `isPrincipalAdmin` = Q2 + droit de
 * déléguer Q2). Les capacités vivent sur `HealthcareMembership` (N-N user↔service).
 *
 * Règles (BASELINE-RBAC / US-2610) :
 *  - Accès à la gestion = **Q2** dans le scope (ADMIN bypass V1).
 *  - Octroi/retrait **Q2** (`canManage`) = **admin principal** (ou ADMIN).
 *  - `isPrincipalAdmin` octroyable **par ADMIN uniquement** (un principal ne nomme
 *    que des délégués, pas d'autres principaux).
 *  - **Q1 octroyable en V1** (« considéré vérifié » ; durci en V4 sur preuve PS).
 *  - **Non-auto-élévation** : on ne modifie pas ses propres capacités.
 *  - **Révocation immédiate** (F7) : bump `authVersion` + `invalidateAllUserSessions`.
 *  - Scope obligatoire : un org-admin ne gère QUE son/ses service(s).
 *
 * ⚠️ V1 : pas de rôle plateforme « gestionnaire non-soignant » (découplage = F1/V4).
 * Un membre invité est un utilisateur **clinique** (`DOCTOR`/`NURSE`). La secrétaire
 * pure Q2-seule est reportée V4. `ADMIN` garde le bypass PHI (risque V1 accepté).
 */

import { randomBytes, randomUUID } from "crypto"
import { hash as bcryptHash } from "bcryptjs"
import type { Role } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import { emailService } from "./email.service"
import { invalidateAllUserSessions } from "@/lib/auth/session"
import { canManageOrg, isPrincipalAdmin } from "@/lib/capabilities"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { hmacEmail, hmacField } from "@/lib/crypto/hmac"
import { logger } from "@/lib/logger"

/** Erreur typée → mappée en statut HTTP par les routes. */
export class OrgMembershipError extends Error {
  constructor(
    public code:
      | "forbidden"
      | "notFound"
      | "invalidState"
      | "selfElevation"
      | "lastPrincipalAdmin"
      | "emailExists",
  ) {
    super(code)
    this.name = "OrgMembershipError"
  }
}

/** Statut HTTP correspondant à un code `OrgMembershipError`. */
export function orgMembershipErrorStatus(code: OrgMembershipError["code"]): number {
  if (code === "forbidden") return 403
  if (code === "notFound") return 404
  return 409 // invalidState / selfElevation / lastPrincipalAdmin / emailExists
}

/** Seuls DOCTOR/NURSE sont des capacités cliniques valides (Q1). */
const CLINICAL_ROLES: ReadonlySet<Role> = new Set<Role>(["DOCTOR", "NURSE"])

/**
 * Cohérence d'état : un admin principal a **forcément** la gestion (Q2). On force
 * `canManage = true` quand `isPrincipalAdmin = true`, et on rejette la combinaison
 * incohérente `isPrincipalAdmin:true + canManage:false` (review HSA LOW).
 */
function normalizeCaps(caps: CapabilityInput): CapabilityInput {
  if (caps.isPrincipalAdmin === true && caps.canManage === false) {
    throw new OrgMembershipError("invalidState")
  }
  return caps.isPrincipalAdmin === true ? { ...caps, canManage: true } : caps
}

export type MemberView = {
  userId: number
  firstname: string | null
  lastname: string | null
  email: string | null
  status: string
  clinicalRole: Role | null
  canManage: boolean
  isPrincipalAdmin: boolean
  /** V1 — toute inscription est « considérée vérifiée » (workflow PS réel = V4). */
  psVerified: boolean
}

export type CapabilityInput = {
  clinicalRole?: Role | null
  canManage?: boolean
  isPrincipalAdmin?: boolean
}

/** Accès à la gestion = Q2 dans le scope (ADMIN bypass V1). */
async function assertCanManage(callerId: number, role: Role, serviceId: number): Promise<void> {
  if (role === "ADMIN") return
  if (!(await canManageOrg(callerId, serviceId))) throw new OrgMembershipError("forbidden")
}

/** Octroi Q2 (`canManage`) réservé admin principal (ou ADMIN). */
async function assertPrincipal(callerId: number, role: Role, serviceId: number): Promise<void> {
  if (role === "ADMIN") return
  if (!(await isPrincipalAdmin(callerId, serviceId))) throw new OrgMembershipError("forbidden")
}

export const orgMembershipService = {
  /** Liste les membres du service (capacités + PII déchiffrée). Gated Q2. */
  async listMembers(
    callerId: number, role: Role, serviceId: number, ctx?: AuditContext,
  ): Promise<MemberView[]> {
    await assertCanManage(callerId, role, serviceId)

    const rows = await prisma.healthcareMembership.findMany({
      where: { serviceId },
      select: {
        userId: true, clinicalRole: true, canManage: true, isPrincipalAdmin: true,
        user: { select: { firstname: true, lastname: true, email: true, status: true } },
      },
      orderBy: { userId: "asc" },
    })

    await auditService.log({
      userId: callerId, action: "READ", resource: "HEALTHCARE_MEMBERSHIP",
      resourceId: String(serviceId), scopeServiceId: serviceId,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { count: rows.length },
    })

    return rows.map((r) => ({
      userId: r.userId,
      firstname: safeDecryptField(r.user.firstname),
      lastname: safeDecryptField(r.user.lastname),
      email: safeDecryptField(r.user.email),
      status: r.user.status,
      clinicalRole: r.clinicalRole,
      canManage: r.canManage,
      isPrincipalAdmin: r.isPrincipalAdmin,
      psVerified: true, // V1
    }))
  },

  /**
   * Invite/rattache un membre au service. User existant → rattache ; sinon crée
   * le User (clinique) + token set-password single-use + email d'invitation.
   */
  async inviteMember(
    callerId: number, role: Role, serviceId: number,
    input: { email: string; firstName?: string; lastName?: string } & CapabilityInput,
    ctx?: AuditContext,
  ): Promise<{ userId: number; invitedNewUser: boolean }> {
    await assertCanManage(callerId, role, serviceId)
    // Octroi Q2 à l'invitation : mêmes gardes que setCapabilities.
    if (input.isPrincipalAdmin && role !== "ADMIN") throw new OrgMembershipError("forbidden")
    const caps = normalizeCaps({
      clinicalRole: input.clinicalRole,
      canManage: input.canManage,
      isPrincipalAdmin: input.isPrincipalAdmin,
    })
    if (caps.canManage) await assertPrincipal(callerId, role, serviceId)
    if (caps.clinicalRole && !CLINICAL_ROLES.has(caps.clinicalRole)) {
      throw new OrgMembershipError("invalidState")
    }

    const emailHmac = hmacEmail(input.email)
    const existing = await prisma.user.findUnique({ where: { emailHmac }, select: { id: true } })

    let resetToken: string | null = null
    const result = await prisma.$transaction(async (tx) => {
      let targetUserId: number
      let invitedNewUser = false

      if (existing) {
        // Rattachement d'un user existant : on NE modifie PAS sa PII (firstName/
        // lastName ignorés volontairement — son identité lui appartient) ni son
        // mot de passe ; on crée seulement l'appartenance au service.
        targetUserId = existing.id
        const dup = await tx.healthcareMembership.findUnique({
          where: { userId_serviceId: { userId: targetUserId, serviceId } },
          select: { id: true },
        })
        if (dup) throw new OrgMembershipError("invalidState") // déjà membre
      } else {
        // Nouveau membre = utilisateur clinique en V1 → clinicalRole requis.
        if (!caps.clinicalRole) throw new OrgMembershipError("invalidState")
        const tempPasswordHash = await bcryptHash(randomBytes(32).toString("base64url"), 12)
        resetToken = randomUUID()
        const user = await tx.user.create({
          data: {
            email: encryptField(input.email),
            emailHmac,
            passwordHash: tempPasswordHash,
            ...(input.firstName && { firstname: encryptField(input.firstName), firstnameHmac: hmacField(input.firstName) }),
            ...(input.lastName && { lastname: encryptField(input.lastName), lastnameHmac: hmacField(input.lastName) }),
            role: caps.clinicalRole,
            status: "active",
            language: "fr",
            needPasswordUpdate: true,
            needOnboarding: true,
          },
          select: { id: true },
        })
        targetUserId = user.id
        invitedNewUser = true
        await tx.verificationToken.deleteMany({ where: { identifier: emailHmac } })
        await tx.verificationToken.create({
          data: { identifier: emailHmac, token: resetToken, expires: new Date(Date.now() + 3600_000) },
        })
      }

      await tx.healthcareMembership.create({
        data: {
          userId: targetUserId, serviceId,
          clinicalRole: caps.clinicalRole ?? null,
          canManage: caps.canManage ?? false,
          isPrincipalAdmin: caps.isPrincipalAdmin ?? false,
        },
      })

      await auditService.logWithTx(tx, {
        userId: callerId, action: "INVITATION_SENT", resource: "ORG_INVITATION",
        resourceId: String(targetUserId), scopeServiceId: serviceId,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          invitedNewUser,
          clinicalRole: caps.clinicalRole ?? null,
          canManage: caps.canManage ?? false,
          isPrincipalAdmin: caps.isPrincipalAdmin ?? false,
        },
      })

      return { userId: targetUserId, invitedNewUser }
    })

    // Hors transaction : email d'invitation (nouveau user) — best-effort.
    if (result.invitedNewUser && resetToken) {
      void emailService.sendStaffInvitation(input.email, resetToken).catch((err) => {
        logger.error("org-membership", "Failed to send staff invitation email", {}, err)
      })
    }

    return result
  },

  /**
   * Modifie les capacités d'un membre. Q2 (`canManage`) = principal-admin ;
   * `isPrincipalAdmin` = ADMIN ; Q1 (`clinicalRole`) = V1. Non-auto-élévation.
   * Révocation/octroi immédiat (bump authVersion + invalidate sessions).
   */
  async setCapabilities(
    callerId: number, role: Role, targetUserId: number, serviceId: number,
    caps: CapabilityInput, ctx?: AuditContext,
  ): Promise<void> {
    await assertCanManage(callerId, role, serviceId)
    if (targetUserId === callerId) throw new OrgMembershipError("selfElevation")
    if (caps.isPrincipalAdmin !== undefined && role !== "ADMIN") throw new OrgMembershipError("forbidden")
    const norm = normalizeCaps(caps)
    if (norm.canManage !== undefined) await assertPrincipal(callerId, role, serviceId)
    if (norm.clinicalRole && !CLINICAL_ROLES.has(norm.clinicalRole)) {
      throw new OrgMembershipError("invalidState")
    }

    const membership = await prisma.healthcareMembership.findUnique({
      where: { userId_serviceId: { userId: targetUserId, serviceId } },
      select: { id: true, clinicalRole: true, canManage: true, isPrincipalAdmin: true },
    })
    if (!membership) throw new OrgMembershipError("notFound")

    // LOW (review) — court-circuit no-op : si les capacités demandées sont déjà en
    // place, ne rien faire (pas de bump authVersion, pas d'invalidation de session,
    // pas de ligne d'audit) → évite un force-logout / bruit d'audit par PATCH vide.
    const changed =
      (norm.clinicalRole !== undefined && norm.clinicalRole !== membership.clinicalRole) ||
      (norm.canManage !== undefined && norm.canManage !== membership.canManage) ||
      (norm.isPrincipalAdmin !== undefined && norm.isPrincipalAdmin !== membership.isPrincipalAdmin)
    if (!changed) return

    // HIGH (review) — anti-lockout symétrique : ne pas retirer `isPrincipalAdmin`
    // du DERNIER admin principal du service (sinon plus personne ne peut octroyer Q2).
    if (norm.isPrincipalAdmin === false && membership.isPrincipalAdmin) {
      const otherPrincipals = await prisma.healthcareMembership.count({
        where: { serviceId, isPrincipalAdmin: true, userId: { not: targetUserId } },
      })
      if (otherPrincipals === 0) throw new OrgMembershipError("lastPrincipalAdmin")
    }

    await prisma.$transaction(async (tx) => {
      await tx.healthcareMembership.update({
        where: { userId_serviceId: { userId: targetUserId, serviceId } },
        data: {
          ...(norm.clinicalRole !== undefined && { clinicalRole: norm.clinicalRole }),
          ...(norm.canManage !== undefined && { canManage: norm.canManage }),
          ...(norm.isPrincipalAdmin !== undefined && { isPrincipalAdmin: norm.isPrincipalAdmin }),
        },
      })
      // F7 — effet immédiat : bump authVersion (rejet refresh) ; invalidate sessions ci-dessous.
      await tx.user.update({ where: { id: targetUserId }, data: { authVersion: { increment: 1 } } })

      await auditService.logWithTx(tx, {
        userId: callerId, action: "CAPABILITY_GRANTED", resource: "HEALTHCARE_MEMBERSHIP",
        resourceId: String(targetUserId), scopeServiceId: serviceId,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        newValue: {
          ...(norm.clinicalRole !== undefined && { clinicalRole: norm.clinicalRole }),
          ...(norm.canManage !== undefined && { canManage: norm.canManage }),
          ...(norm.isPrincipalAdmin !== undefined && { isPrincipalAdmin: norm.isPrincipalAdmin }),
        },
      })
    })

    await invalidateAllUserSessions(targetUserId).catch((err) => {
      logger.error("org-membership", "Failed to invalidate sessions after capability change", {}, err)
    })
  },

  /**
   * Retire un membre du service (appartenance supprimée). Données déjà créées
   * conservées (append-only). Anti-self-lockout : le dernier admin principal ne
   * peut pas se retirer. Révocation immédiate.
   */
  async revokeMember(
    callerId: number, role: Role, targetUserId: number, serviceId: number, ctx?: AuditContext,
  ): Promise<void> {
    await assertCanManage(callerId, role, serviceId)

    const membership = await prisma.healthcareMembership.findUnique({
      where: { userId_serviceId: { userId: targetUserId, serviceId } },
      select: { id: true, isPrincipalAdmin: true },
    })
    if (!membership) throw new OrgMembershipError("notFound")

    // Anti-self-lockout : ne pas retirer le dernier admin principal du service.
    if (membership.isPrincipalAdmin) {
      const otherPrincipals = await prisma.healthcareMembership.count({
        where: { serviceId, isPrincipalAdmin: true, userId: { not: targetUserId } },
      })
      if (otherPrincipals === 0) throw new OrgMembershipError("lastPrincipalAdmin")
    }

    await prisma.$transaction(async (tx) => {
      await tx.healthcareMembership.delete({
        where: { userId_serviceId: { userId: targetUserId, serviceId } },
      })
      await tx.user.update({ where: { id: targetUserId }, data: { authVersion: { increment: 1 } } })
      await auditService.logWithTx(tx, {
        userId: callerId, action: "CAPABILITY_REVOKED", resource: "HEALTHCARE_MEMBERSHIP",
        resourceId: String(targetUserId), scopeServiceId: serviceId,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { kind: "memberRemoved" },
      })
    })

    await invalidateAllUserSessions(targetUserId).catch((err) => {
      logger.error("org-membership", "Failed to invalidate sessions after member revoke", {}, err)
    })
  },
}
