/**
 * @module healthcare-management.service
 * @description US-2118 + US-2117 — CRUD ADMIN sur les structures de soin
 * (cabinets, hôpitaux, praticiens libéraux).
 *
 * Distinct du `healthcare.service` (qui gère l'enrôlement patient et les
 * référents). Ce service est utilisé par les routes admin pour créer /
 * lister / mettre à jour / supprimer les structures.
 *
 * **HDS** : pas de PHI dans HealthcareService. Audit standard READ/CREATE/UPDATE/DELETE.
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import type { ServiceType, Prisma } from "@prisma/client"

const MAX_LIST_LIMIT = 200

interface ListFilter {
  /** Filtre type structure. */
  type?: ServiceType
  /** Recherche sur nom (LIKE %x%). */
  search?: string
  limit?: number
  cursor?: number
}

interface CreateInput {
  name: string
  type: ServiceType
  establishment?: string | null
  city?: string | null
  country?: string | null
  /** RPPS / ADELI — requis pour `freelance`, optionnel sinon. */
  licenseNumber?: string | null
}

interface UpdateInput {
  name?: string
  type?: ServiceType
  establishment?: string | null
  city?: string | null
  country?: string | null
  licenseNumber?: string | null
}

/**
 * Validation Luhn (mod-10) — RPPS et ADELI utilisent ce checksum sur tous
 * les chiffres. Tolère erreurs de saisie d'un chiffre (typo) et
 * permutations adjacentes.
 */
function luhnValid(s: string): boolean {
  let sum = 0
  let alt = false
  for (let i = s.length - 1; i >= 0; i--) {
    let d = Number(s[i])
    if (alt) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    alt = !alt
  }
  return sum % 10 === 0
}

/**
 * Validation FR : RPPS sur 11 chiffres, ADELI sur 9 chiffres, avec checksum
 * Luhn dans les deux cas. Refuse les longueurs intermédiaires (10 chiffres
 * ne correspondent à aucun registre officiel) et les checksums invalides
 * (typos qui passeraient un simple format check).
 *
 * Retourne `null` si valide, code d'erreur sinon.
 */
export function validateLicenseNumber(value: string): string | null {
  const trimmed = value.trim()
  if (!/^([0-9]{9}|[0-9]{11})$/.test(trimmed)) {
    return "license_number_invalid_format"
  }
  if (!luhnValid(trimmed)) {
    return trimmed.length === 11
      ? "rpps_checksum_invalid"
      : "adeli_checksum_invalid"
  }
  return null
}

export const healthcareManagementService = {
  async list(filter: ListFilter, auditUserId: number, ctx?: AuditContext) {
    const limit = Math.min(filter.limit ?? 50, MAX_LIST_LIMIT)
    const where: Prisma.HealthcareServiceWhereInput = {
      ...(filter.type && { type: filter.type }),
      ...(filter.search?.trim() && {
        name: { contains: filter.search.trim(), mode: "insensitive" },
      }),
    }

    const items = await prisma.healthcareService.findMany({
      where,
      include: { _count: { select: { members: true, patientServices: true } } },
      orderBy: { name: "asc" },
      take: limit + 1,
      ...(filter.cursor && { cursor: { id: filter.cursor }, skip: 1 }),
    })

    const hasMore = items.length > limit
    const page = hasMore ? items.slice(0, limit) : items
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "HEALTHCARE_SERVICE",
      resourceId: "admin:healthcare:list",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: { count: page.length, type: filter.type ?? null },
    })

    return { items: page, nextCursor }
  },

  async create(input: CreateInput, auditUserId: number, ctx?: AuditContext) {
    // Praticien libéral : licenseNumber obligatoire (RPPS / ADELI).
    if (input.type === "freelance") {
      if (!input.licenseNumber?.trim()) {
        throw new Error("license_number_required_for_freelance")
      }
      const error = validateLicenseNumber(input.licenseNumber)
      if (error) throw new Error(error)
    }

    return prisma.$transaction(async (tx) => {
      const created = await tx.healthcareService.create({
        data: {
          name: input.name.trim(),
          type: input.type,
          establishment: input.establishment?.trim() || null,
          city: input.city?.trim() || null,
          country: input.country?.trim() || null,
          licenseNumber: input.licenseNumber?.trim() || null,
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "HEALTHCARE_SERVICE",
        resourceId: `healthcare-service:${created.id}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: { type: input.type },
      })

      return created
    })
  },

  async update(
    serviceId: number,
    input: UpdateInput,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    if (input.licenseNumber?.trim()) {
      const error = validateLicenseNumber(input.licenseNumber)
      if (error) throw new Error(error)
    }

    return prisma.$transaction(async (tx) => {
      const current = await tx.healthcareService.findUnique({
        where: { id: serviceId },
      })
      if (!current) throw new Error("service_not_found")

      // Si on bascule vers freelance, vérifier qu'on a un licenseNumber.
      const targetType = input.type ?? current.type
      const targetLicense = input.licenseNumber ?? current.licenseNumber
      if (targetType === "freelance" && !targetLicense?.trim()) {
        throw new Error("license_number_required_for_freelance")
      }

      const updated = await tx.healthcareService.update({
        where: { id: serviceId },
        data: {
          ...(input.name !== undefined && { name: input.name.trim() }),
          ...(input.type !== undefined && { type: input.type }),
          ...(input.establishment !== undefined && {
            establishment: input.establishment?.trim() || null,
          }),
          ...(input.city !== undefined && { city: input.city?.trim() || null }),
          ...(input.country !== undefined && {
            country: input.country?.trim() || null,
          }),
          ...(input.licenseNumber !== undefined && {
            licenseNumber: input.licenseNumber?.trim() || null,
          }),
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "HEALTHCARE_SERVICE",
        resourceId: `healthcare-service:${serviceId}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        oldValue: { type: current.type, name: current.name },
        newValue: { type: updated.type, name: updated.name },
      })

      return updated
    })
  },

  async getById(serviceId: number, auditUserId: number, ctx?: AuditContext) {
    const service = await prisma.healthcareService.findUnique({
      where: { id: serviceId },
      include: {
        _count: { select: { members: true, patientServices: true } },
        members: { select: { id: true, name: true, userId: true } },
      },
    })
    if (!service) return null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "HEALTHCARE_SERVICE",
      resourceId: `healthcare-service:${serviceId}`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
    })

    return service
  },
}
