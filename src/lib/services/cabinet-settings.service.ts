/**
 * @module cabinet-settings.service
 * @description Groupe 9 — US-2147 Paramètres cabinet (manager-level).
 *
 * Complète l'admin CRUD existant `/api/admin/healthcare-services`
 * (US-2117/2118) avec une route manager-level : le manager d'un cabinet
 * (HealthcareService.managerId) peut éditer son propre cabinet sans
 * être ADMIN, mais sur un sous-ensemble réduit de champs (settings UX :
 * coordonnées de contact, horaires d'ouverture, flags noVideos/noFood,
 * spécialités). Les champs régaliens (SIRET, TVA, IBAN, country, type,
 * licenseNumber) restent ADMIN-only.
 *
 * Audit US-2268 : `resourceId = healthcareService.id`, kind typé.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"
import { openingHoursSchema } from "./healthcare-management.service"

// ─────────────────────────────────────────────────────────────
// Audit kinds typés
// ─────────────────────────────────────────────────────────────

export type CabinetSettingsAuditKind =
  | "cabinet_settings.read"
  | "cabinet_settings.update"

const AUDIT_KIND = {
  READ: "cabinet_settings.read",
  UPDATE: "cabinet_settings.update",
} as const satisfies Record<string, CabinetSettingsAuditKind>

// ─────────────────────────────────────────────────────────────
// Erreurs typées
// ─────────────────────────────────────────────────────────────

export class CabinetSettingsAccessError extends Error {
  constructor() {
    super("notCabinetManager")
    this.name = "CabinetSettingsAccessError"
  }
}

export class CabinetSettingsNotFoundError extends Error {
  constructor() {
    super("cabinetNotFound")
    this.name = "CabinetSettingsNotFoundError"
  }
}

/**
 * H2 (review re-1 PR #409) — Erreur de validation typée. Évite le
 * `throw new Error()` brut qui était mappé 500 au lieu de 422.
 */
export class CabinetSettingsValidationError extends Error {
  constructor(public field: string) {
    super(field)
    this.name = "CabinetSettingsValidationError"
  }
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface ManagerSettingsInput {
  phone?: string | null
  email?: string | null
  website?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  postalCode?: string | null
  city?: string | null
  openingHours?: Prisma.InputJsonValue | null
  specialties?: string[]
  capacity?: number | null
  noVideos?: boolean
  noFood?: boolean
}

export interface CabinetSettingsDTO {
  id: number
  name: string
  establishment: string | null
  phone: string | null
  email: string | null
  website: string | null
  addressLine1: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  country: string | null
  openingHours: Prisma.JsonValue | null
  specialties: string[]
  capacity: number | null
  noVideos: boolean
  noFood: boolean
  managerId: number | null
  /** Champs régaliens lus mais non-éditables côté manager. */
  siret: string | null
  tvaIntra: string | null
  type: string
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function assertManagerOrAdmin(
  cabinetId: number,
  userId: number,
  role: string,
): Promise<{ id: number; managerId: number | null }> {
  const cabinet = await prisma.healthcareService.findUnique({
    where: { id: cabinetId },
    select: { id: true, managerId: true },
  })
  if (!cabinet) throw new CabinetSettingsNotFoundError()
  // ADMIN passe ; sinon manager-only.
  if (role !== "ADMIN" && cabinet.managerId !== userId) {
    throw new CabinetSettingsAccessError()
  }
  return cabinet
}

// ─────────────────────────────────────────────────────────────
// Service public
// ─────────────────────────────────────────────────────────────

export const cabinetSettingsService = {
  /**
   * Lecture des settings d'un cabinet. Manager ou ADMIN.
   */
  async get(
    cabinetId: number,
    auditUserId: number,
    auditUserRole: string,
    ctx?: AuditContext,
  ): Promise<CabinetSettingsDTO> {
    await assertManagerOrAdmin(cabinetId, auditUserId, auditUserRole)

    const cabinet = await prisma.healthcareService.findUnique({
      where: { id: cabinetId },
    })
    if (!cabinet) throw new CabinetSettingsNotFoundError()

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "CABINET_SETTINGS",
      resourceId: String(cabinetId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { kind: AUDIT_KIND.READ },
    })

    return {
      id: cabinet.id,
      name: cabinet.name,
      establishment: cabinet.establishment,
      phone: cabinet.phone,
      email: cabinet.email,
      website: cabinet.website,
      addressLine1: cabinet.addressLine1,
      addressLine2: cabinet.addressLine2,
      postalCode: cabinet.postalCode,
      city: cabinet.city,
      country: cabinet.country,
      openingHours: cabinet.openingHours,
      specialties: cabinet.specialties,
      capacity: cabinet.capacity,
      noVideos: cabinet.noVideos,
      noFood: cabinet.noFood,
      managerId: cabinet.managerId,
      siret: cabinet.siret,
      tvaIntra: cabinet.tvaIntra,
      type: cabinet.type,
    }
  },

  /**
   * Met à jour les settings d'un cabinet — sous-ensemble manager-level.
   * Les champs régaliens (siret/tvaIntra/iban/country/type/licenseNumber)
   * NE PEUVENT PAS être modifiés ici → utiliser `/api/admin/healthcare-services`.
   */
  async update(
    cabinetId: number,
    input: ManagerSettingsInput,
    auditUserId: number,
    auditUserRole: string,
    ctx?: AuditContext,
  ): Promise<CabinetSettingsDTO> {
    await assertManagerOrAdmin(cabinetId, auditUserId, auditUserRole)

    // Validation openingHours si fourni.
    // H2 (review re-1) — `CabinetSettingsValidationError` mappé en 422
    // par la route, vs `throw new Error` mappé 500.
    if (input.openingHours !== undefined && input.openingHours !== null) {
      const parsed = openingHoursSchema.safeParse(input.openingHours)
      if (!parsed.success) {
        throw new CabinetSettingsValidationError("openingHours")
      }
    }

    const data: Prisma.HealthcareServiceUpdateInput = {}
    if (input.phone !== undefined) data.phone = input.phone
    if (input.email !== undefined) data.email = input.email
    if (input.website !== undefined) data.website = input.website
    if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1
    if (input.addressLine2 !== undefined) data.addressLine2 = input.addressLine2
    if (input.postalCode !== undefined) data.postalCode = input.postalCode
    if (input.city !== undefined) data.city = input.city
    if (input.openingHours !== undefined) {
      data.openingHours = input.openingHours ?? Prisma.JsonNull
    }
    if (input.specialties !== undefined) data.specialties = { set: input.specialties }
    if (input.capacity !== undefined) data.capacity = input.capacity
    if (input.noVideos !== undefined) data.noVideos = input.noVideos
    if (input.noFood !== undefined) data.noFood = input.noFood

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.healthcareService.update({
        where: { id: cabinetId },
        data,
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "CABINET_SETTINGS",
        resourceId: String(cabinetId),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          kind: AUDIT_KIND.UPDATE,
          fields: Object.keys(data),
        },
      })
      return u
    })

    return {
      id: updated.id,
      name: updated.name,
      establishment: updated.establishment,
      phone: updated.phone,
      email: updated.email,
      website: updated.website,
      addressLine1: updated.addressLine1,
      addressLine2: updated.addressLine2,
      postalCode: updated.postalCode,
      city: updated.city,
      country: updated.country,
      openingHours: updated.openingHours,
      specialties: updated.specialties,
      capacity: updated.capacity,
      noVideos: updated.noVideos,
      noFood: updated.noFood,
      managerId: updated.managerId,
      siret: updated.siret,
      tvaIntra: updated.tvaIntra,
      type: updated.type,
    }
  },
}

