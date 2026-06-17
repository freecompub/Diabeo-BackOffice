/**
 * @module tenant.service
 * @description US-2613 — Administration plateforme : gestion des **tenants**
 * (établissements organisationnels). Réservé `SYSTEM_ADMIN` (= `ADMIN` en V1 ;
 * renommage F1/V4). La garde de rôle est portée par les routes (`requireRole`,
 * convention des services admin) ; le service prend `auditUserId` pour la trace.
 *
 * Modèle léger (F2) : 1 cabinet libéral = 1 tenant ; 1 hôpital = 1 tenant à N
 * services. Le `country` du tenant pilote la résolution de la politique de
 * vérification (`tenant > pays > défaut`, cf. `capabilities.resolveVerificationPolicy`).
 *
 * **Aucune donnée de santé** : un tenant ne porte que des métadonnées d'organisation.
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"

/** Erreur typée → mappée en statut HTTP par les routes. */
export class TenantError extends Error {
  constructor(public code: "notFound" | "invalidState") {
    super(code)
    this.name = "TenantError"
  }
}

/** Statut HTTP correspondant à un code `TenantError`. */
export function tenantErrorStatus(code: TenantError["code"]): number {
  return code === "notFound" ? 404 : 409
}

export type TenantInput = {
  name: string
  /** ISO-3166-1 alpha-2 (FR, DZ…) ou null. Normalisé en majuscules. */
  country?: string | null
}

export type TenantView = {
  id: number
  name: string
  country: string | null
  createdAt: Date
  serviceCount: number
}

/** Normalise un code pays (trim + uppercase) ; null si vide. */
function normalizeCountry(country?: string | null): string | null {
  const c = country?.trim().toUpperCase()
  return c ? c : null
}

export const tenantService = {
  /** Liste tous les tenants (+ nombre de services rattachés). */
  async list(auditUserId: number, ctx?: AuditContext): Promise<TenantView[]> {
    const rows = await prisma.tenant.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true, name: true, country: true, createdAt: true,
        _count: { select: { services: true } },
      },
    })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "TENANT",
      resourceId: "admin:tenants:list",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { count: rows.length },
    })

    return rows.map((r) => ({
      id: r.id, name: r.name, country: r.country, createdAt: r.createdAt,
      serviceCount: r._count.services,
    }))
  },

  /** Détail d'un tenant. */
  async getById(tenantId: number, auditUserId: number, ctx?: AuditContext): Promise<TenantView> {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, name: true, country: true, createdAt: true,
        _count: { select: { services: true } },
      },
    })
    if (!t) throw new TenantError("notFound")

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "TENANT",
      resourceId: String(tenantId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
    })

    return {
      id: t.id, name: t.name, country: t.country, createdAt: t.createdAt,
      serviceCount: t._count.services,
    }
  },

  /** Crée un tenant. */
  async create(input: TenantInput, auditUserId: number, ctx?: AuditContext): Promise<{ id: number }> {
    const name = input.name.trim()
    if (name.length < 2) throw new TenantError("invalidState")

    return prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: { name, country: normalizeCountry(input.country) },
        select: { id: true },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "TENANT",
        resourceId: String(created.id), tenantId: created.id,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { name, country: normalizeCountry(input.country) },
      })
      return created
    })
  },

  /** Met à jour le nom et/ou le pays d'un tenant. */
  async update(
    tenantId: number, input: Partial<TenantInput>, auditUserId: number, ctx?: AuditContext,
  ): Promise<void> {
    const existing = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!existing) throw new TenantError("notFound")

    const data: { name?: string; country?: string | null } = {}
    if (input.name !== undefined) {
      const name = input.name.trim()
      if (name.length < 2) throw new TenantError("invalidState")
      data.name = name
    }
    if (input.country !== undefined) data.country = normalizeCountry(input.country)
    if (Object.keys(data).length === 0) return // no-op

    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: tenantId }, data })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "TENANT",
        resourceId: String(tenantId), tenantId,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        newValue: data,
      })
    })
  },

  /**
   * Rattache (ou détache via `tenantId = null`) un établissement à un tenant.
   * N'altère PAS l'établissement lui-même (service `healthcare-management`
   * intouché) — uniquement le lien `HealthcareService.tenantId`.
   */
  async assignService(
    serviceId: number, tenantId: number | null, auditUserId: number, ctx?: AuditContext,
  ): Promise<void> {
    const service = await prisma.healthcareService.findUnique({
      where: { id: serviceId }, select: { id: true },
    })
    if (!service) throw new TenantError("notFound")
    if (tenantId !== null) {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
      if (!tenant) throw new TenantError("notFound")
    }

    await prisma.$transaction(async (tx) => {
      await tx.healthcareService.update({ where: { id: serviceId }, data: { tenantId } })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "HEALTHCARE_SERVICE",
        resourceId: String(serviceId), ...(tenantId !== null && { tenantId }),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { kind: "tenantAssignment", tenantId },
      })
    })
  },
}
