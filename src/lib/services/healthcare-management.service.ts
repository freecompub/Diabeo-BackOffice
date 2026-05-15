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
import { z } from "zod"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import { Prisma } from "@prisma/client"
import type { ServiceType } from "@prisma/client"

const MAX_LIST_LIMIT = 200

/**
 * Source unique du regex HH:MM (00:00 – 23:59) — ré-exporté pour les
 * routes Zod afin d'éviter trois copies divergentes.
 */
export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/

/** US-2117 — Schemas Zod partagés pour les routes (évite duplication route ↔ [id]). */
export const timeSchema = z.string().regex(TIME_REGEX, "time_format_invalid")
export const daySchema = z.array(z.tuple([timeSchema, timeSchema])).max(4)
export const openingHoursSchema = z.object({
  mon: daySchema.optional(),
  tue: daySchema.optional(),
  wed: daySchema.optional(),
  thu: daySchema.optional(),
  fri: daySchema.optional(),
  sat: daySchema.optional(),
  sun: daySchema.optional(),
})

interface ListFilter {
  /** Filtre type structure. */
  type?: ServiceType
  /** Recherche sur nom (LIKE %x%). */
  search?: string
  limit?: number
  cursor?: number
}

/**
 * US-2117 — Format des horaires d'ouverture, jour par jour.
 * Tableau de plages `[ouverture, fermeture]` au format `"HH:MM"`. Un tableau
 * vide signifie "fermé" ce jour. Plusieurs plages permettent de modéliser la
 * pause déjeuner (`[["09:00","12:00"],["14:00","18:00"]]`).
 */
export type DaySchedule = [string, string][]
export interface OpeningHours {
  mon?: DaySchedule
  tue?: DaySchedule
  wed?: DaySchedule
  thu?: DaySchedule
  fri?: DaySchedule
  sat?: DaySchedule
  sun?: DaySchedule
}

/**
 * Validate `OpeningHours`. Returns null when valid, error code otherwise.
 * Garantit :
 *  - Format HH:MM strict
 *  - Heure de fermeture > ouverture (par plage)
 *  - Pas de chevauchement entre plages d'un même jour
 */
export function validateOpeningHours(hours: OpeningHours): string | null {
  for (const day of Object.keys(hours) as (keyof OpeningHours)[]) {
    const ranges = hours[day]
    if (!ranges) continue
    if (!Array.isArray(ranges)) return "opening_hours_invalid_shape"
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length !== 2) {
        return "opening_hours_invalid_range"
      }
      const [open, close] = range
      if (!TIME_REGEX.test(open) || !TIME_REGEX.test(close)) {
        return "opening_hours_invalid_time_format"
      }
      if (open >= close) return "opening_hours_close_before_open"
    }
    // Check for overlapping ranges within the day.
    const sorted = [...ranges].sort((a, b) => a[0].localeCompare(b[0]))
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]![0] < sorted[i - 1]![1]) {
        return "opening_hours_ranges_overlap"
      }
    }
  }
  return null
}

interface CreateInput {
  name: string
  type: ServiceType
  establishment?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  postalCode?: string | null
  city?: string | null
  country?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  openingHours?: OpeningHours | null
  specialties?: string[]
  capacity?: number | null
  managerId?: number | null
  /** RPPS / ADELI — requis pour `freelance`, optionnel sinon. */
  licenseNumber?: string | null
}

interface UpdateInput {
  name?: string
  type?: ServiceType
  establishment?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  postalCode?: string | null
  city?: string | null
  country?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  openingHours?: OpeningHours | null
  specialties?: string[]
  capacity?: number | null
  managerId?: number | null
  licenseNumber?: string | null
}

/**
 * Validation Luhn (mod-10) — RPPS, ADELI, SIRET utilisent ce checksum
 * sur tous les chiffres. Tolère erreurs de saisie d'un chiffre (typo)
 * et permutations adjacentes.
 *
 * Exporté pour réutilisation (US-2103 SIRET validation, US-2118 RPPS).
 */
export function luhnValid(s: string): boolean {
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

/**
 * US-2103 H-NEW-1 (review PR #406) — Validation SIRET FR sur 14 chiffres
 * avec checksum Luhn. Refuse les `00000000000000` et autres formats
 * sans contrôle de cohérence qui passeraient un simple regex.
 *
 * Note : La Poste (SIREN 356000000) est une exception historique au Luhn
 * (somme de digits multiple de 5). Ignoré pour MVP — un cabinet médical
 * n'a aucune raison d'avoir un SIRET La Poste.
 *
 * @returns `null` si valide, code d'erreur sinon.
 */
export function validateSiret(value: string): string | null {
  const trimmed = value.trim()
  if (!/^[0-9]{14}$/.test(trimmed)) {
    return "siret_invalid_format"
  }
  if (!luhnValid(trimmed)) {
    return "siret_checksum_invalid"
  }
  return null
}

/**
 * Vérifie qu'un `managerId` proposé pointe sur un User actif au rôle compatible
 * (DOCTOR ou ADMIN). Empêche un caller d'assigner n'importe quel ID arbitraire
 * comme manager d'un cabinet (escalade implicite ou pollution référentielle).
 *
 * Throw : `manager_not_found` | `manager_role_invalid` | `manager_inactive`.
 */
async function assertManagerEligible(
  tx: Prisma.TransactionClient,
  managerId: number,
): Promise<void> {
  const u = await tx.user.findUnique({
    where: { id: managerId },
    select: { id: true, role: true, status: true },
  })
  if (!u) throw new Error("manager_not_found")
  if (u.role !== "DOCTOR" && u.role !== "ADMIN") {
    throw new Error("manager_role_invalid")
  }
  if (u.status !== "active") throw new Error("manager_inactive")
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

    if (input.openingHours) {
      const err = validateOpeningHours(input.openingHours)
      if (err) throw new Error(err)
    }

    return prisma.$transaction(async (tx) => {
      if (input.managerId != null) {
        await assertManagerEligible(tx, input.managerId)
      }

      const created = await tx.healthcareService.create({
        data: {
          name: input.name.trim(),
          type: input.type,
          establishment: input.establishment?.trim() || null,
          addressLine1: input.addressLine1?.trim() || null,
          addressLine2: input.addressLine2?.trim() || null,
          postalCode: input.postalCode?.trim() || null,
          city: input.city?.trim() || null,
          country: input.country?.trim() || null,
          phone: input.phone?.trim() || null,
          email: input.email?.trim() || null,
          website: input.website?.trim() || null,
          openingHours: (input.openingHours as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          specialties: input.specialties ?? [],
          capacity: input.capacity ?? null,
          managerId: input.managerId ?? null,
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
        metadata: { type: input.type, managerId: created.managerId },
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

    if (input.openingHours) {
      const err = validateOpeningHours(input.openingHours)
      if (err) throw new Error(err)
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

      // Si le caller (re)assigne un manager non null, valider son éligibilité.
      // Un explicite `null` (désassignation) n'a pas besoin de validation.
      if (input.managerId != null) {
        await assertManagerEligible(tx, input.managerId)
      }

      const updated = await tx.healthcareService.update({
        where: { id: serviceId },
        data: {
          ...(input.name !== undefined && { name: input.name.trim() }),
          ...(input.type !== undefined && { type: input.type }),
          ...(input.establishment !== undefined && {
            establishment: input.establishment?.trim() || null,
          }),
          ...(input.addressLine1 !== undefined && {
            addressLine1: input.addressLine1?.trim() || null,
          }),
          ...(input.addressLine2 !== undefined && {
            addressLine2: input.addressLine2?.trim() || null,
          }),
          ...(input.postalCode !== undefined && {
            postalCode: input.postalCode?.trim() || null,
          }),
          ...(input.city !== undefined && { city: input.city?.trim() || null }),
          ...(input.country !== undefined && {
            country: input.country?.trim() || null,
          }),
          ...(input.phone !== undefined && { phone: input.phone?.trim() || null }),
          ...(input.email !== undefined && { email: input.email?.trim() || null }),
          ...(input.website !== undefined && {
            website: input.website?.trim() || null,
          }),
          ...(input.openingHours !== undefined && {
            openingHours: (input.openingHours as Prisma.InputJsonValue | null) ?? Prisma.JsonNull,
          }),
          ...(input.specialties !== undefined && { specialties: input.specialties }),
          ...(input.capacity !== undefined && { capacity: input.capacity }),
          ...(input.managerId !== undefined && { managerId: input.managerId }),
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
        // `managerId` capture explicite : changement de manager = event de
        // contrôle d'accès (le manager voit tous les patients du service via
        // PatientService) — doit apparaître dans la trace d'audit.
        oldValue: { type: current.type, name: current.name, managerId: current.managerId },
        newValue: { type: updated.type, name: updated.name, managerId: updated.managerId },
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
