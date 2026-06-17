/**
 * @module platform-admin.service
 * @description US-2613 — Administration plateforme : **bootstrap** d'un premier
 * org-admin et **vue personnel cross-tenant**. Réservé `SYSTEM_ADMIN` (= `ADMIN`
 * V1 ; garde de rôle portée par les routes).
 *
 * Réutilise le socle US-2610 : `orgMembershipService.inviteMember` (création user +
 * invitation single-use + capacités) et `revokeMember` (révocation immédiate F7).
 * La révocation cross-tenant passe directement par `revokeMember(..., "ADMIN", ...)`
 * (l'ADMIN bypasse le scope) → pas de logique dupliquée ici.
 *
 * **Aucune donnée de santé** : la vue personnel n'expose que la PII admin (identité,
 * compte) + les capacités/scope — jamais de dossier patient (séparation hébergeur↔soignant).
 */

import type { Role } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import { orgMembershipService } from "./org-membership.service"
import { safeDecryptField } from "@/lib/crypto/fields"

/** Erreur typée → mappée en statut HTTP par les routes. */
export class PlatformAdminError extends Error {
  constructor(public code: "notFound" | "alreadyBootstrapped") {
    super(code)
    this.name = "PlatformAdminError"
  }
}

export function platformAdminErrorStatus(code: PlatformAdminError["code"]): number {
  return code === "notFound" ? 404 : 409
}

export type PersonnelMembershipView = {
  serviceId: number
  serviceName: string
  tenantId: number | null
  clinicalRole: Role | null
  canManage: boolean
  isPrincipalAdmin: boolean
}

export type PersonnelView = {
  user: {
    id: number
    firstname: string | null
    lastname: string | null
    email: string | null
    role: Role
    status: string
  }
  memberships: PersonnelMembershipView[]
}

export const platformAdminService = {
  /**
   * Vue **cross-tenant** d'un compte : identité (PII admin déchiffrée) + toutes ses
   * appartenances scopées (capacités Q1/Q2 + tenant). Base de l'offboarding/incident.
   */
  async getUserCapabilities(
    targetUserId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<PersonnelView> {
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, firstname: true, lastname: true, email: true, role: true, status: true },
    })
    if (!user) throw new PlatformAdminError("notFound")

    const memberships = await prisma.healthcareMembership.findMany({
      where: { userId: targetUserId },
      select: {
        serviceId: true, clinicalRole: true, canManage: true, isPrincipalAdmin: true,
        service: { select: { name: true, tenantId: true } },
      },
      orderBy: { serviceId: "asc" },
    })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "USER",
      resourceId: String(targetUserId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { kind: "platformPersonnelView", membershipCount: memberships.length },
    })

    return {
      user: {
        id: user.id,
        firstname: safeDecryptField(user.firstname),
        lastname: safeDecryptField(user.lastname),
        email: safeDecryptField(user.email),
        role: user.role,
        status: user.status,
      },
      memberships: memberships.map((m) => ({
        serviceId: m.serviceId,
        serviceName: m.service.name,
        tenantId: m.service.tenantId,
        clinicalRole: m.clinicalRole,
        canManage: m.canManage,
        isPrincipalAdmin: m.isPrincipalAdmin,
      })),
    }
  },

  /**
   * Bootstrap : invite le **premier** org-admin (admin principal Q2 + Q1) d'un
   * établissement existant. Refuse si l'établissement a déjà un admin principal
   * (utiliser la gestion cabinet normale au-delà du premier). Délègue la création
   * user + invitation single-use + capacités à `orgMembershipService.inviteMember`.
   */
  async bootstrapOrgAdmin(
    serviceId: number,
    admin: { email: string; firstName?: string; lastName?: string; clinicalRole: Role },
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<{ userId: number; invitedNewUser: boolean }> {
    const service = await prisma.healthcareService.findUnique({
      where: { id: serviceId }, select: { id: true },
    })
    if (!service) throw new PlatformAdminError("notFound")

    // Bootstrap = PREMIER admin principal : refuse si un principal existe déjà.
    const existingPrincipal = await prisma.healthcareMembership.findFirst({
      where: { serviceId, isPrincipalAdmin: true }, select: { id: true },
    })
    if (existingPrincipal) throw new PlatformAdminError("alreadyBootstrapped")

    // ADMIN caller → inviteMember bypasse le scope + autorise isPrincipalAdmin.
    const result = await orgMembershipService.inviteMember(
      auditUserId, "ADMIN", serviceId,
      {
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        clinicalRole: admin.clinicalRole,
        isPrincipalAdmin: true, // → normalizeCaps force canManage = true
      },
      ctx,
    )

    await auditService.log({
      userId: auditUserId, action: "ORG_ADMIN_BOOTSTRAPPED", resource: "ORG_INVITATION",
      resourceId: String(result.userId), scopeServiceId: serviceId,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { serviceId, invitedNewUser: result.invitedNewUser },
    })

    return result
  },
}
