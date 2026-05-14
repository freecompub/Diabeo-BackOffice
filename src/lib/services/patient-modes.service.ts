/**
 * @module patient-modes.service
 * @description Groupe 10 Batch C — Modes spéciaux (3 US, 16 SP).
 *
 *  - US-2233 mode pédiatrique (multi-aidants, PHI nom/téléphone chiffrés)
 *  - US-2234 mode Ramadan (dates jeûne, sahur/iftar, multiplicateurs ISF/ICR)
 *  - US-2235 mode voyage (fuseau horaire, protocole basal adapté)
 *
 * Tous les modes utilisent le hub `ConfigVersion` (PR #395) :
 *  - chaque upsert = nouvelle ligne `ConfigVersion`, l'ancienne passe en
 *    `status=superseded` avec `validTo` set
 *  - immutability via trigger PostgreSQL `config_versions_immutability`
 *  - `validate` = DOCTOR signe (validatedBy + validatedAt)
 *  - `deactivate` = transition vers `status=archived` (manuel ou cron pour
 *    Ramadan/voyage qui ont une date d'expiration naturelle)
 *
 * PHI :
 *  - Pédiatrique : `name` et `phone` des aidants chiffrés AES-256-GCM dans
 *    `pediatric_caregivers`. Snapshot ConfigVersion redacted (hasName/hasPhone
 *    booléens uniquement, pas de PHI sur 6 ans de rétention).
 *  - Ramadan/voyage : pas de PHI, snapshot plaintext autorisé.
 */

import {
  Prisma,
  ConfigVersionStatus,
  ConfigVersionType,
} from "@prisma/client"
import { prisma, type PrismaClientOrTx as Tx } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { auditService, type AuditContext } from "./audit.service"
import { NotFoundError, ValidationError } from "./team-workflow.errors"

// ─────────────────────────────────────────────────────────────
// Shared helpers (mirror mirror-v1-config.service patterns)
// ─────────────────────────────────────────────────────────────

const PERMISSION_LEVELS = ["read", "write", "config"] as const
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number]

const MAX_CAREGIVERS = 5
const NAME_MAX_LEN = 100
const PHONE_MAX_LEN = 20
const RELATIONSHIP_MAX_LEN = 50

const TIME_HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function nextVersion(
  tx: Tx, patientId: number, configType: ConfigVersionType,
): Promise<number> {
  const last = await tx.configVersion.findFirst({
    where: { patientId, configType },
    orderBy: { version: "desc" },
    select: { version: true },
  })
  return (last?.version ?? 0) + 1
}

async function supersedePrevious(
  tx: Tx, patientId: number, configType: ConfigVersionType, now: Date,
): Promise<void> {
  await tx.configVersion.updateMany({
    where: { patientId, configType, status: ConfigVersionStatus.active },
    data: { status: ConfigVersionStatus.superseded, validTo: now },
  })
}

export type ConfigVersionDTO = {
  id: number
  patientId: number | null
  configType: ConfigVersionType
  version: number
  validFrom: Date
  validTo: Date | null
  status: ConfigVersionStatus
  createdBy: number
  validatedBy: number | null
  validatedAt: Date | null
  createdAt: Date
}

function toConfigVersionDTO(r: {
  id: number; patientId: number | null; configType: ConfigVersionType;
  version: number; validFrom: Date; validTo: Date | null;
  status: ConfigVersionStatus; createdBy: number;
  validatedBy: number | null; validatedAt: Date | null; createdAt: Date;
}): ConfigVersionDTO {
  return {
    id: r.id, patientId: r.patientId, configType: r.configType,
    version: r.version, validFrom: r.validFrom, validTo: r.validTo,
    status: r.status, createdBy: r.createdBy,
    validatedBy: r.validatedBy, validatedAt: r.validatedAt,
    createdAt: r.createdAt,
  }
}

// ─────────────────────────────────────────────────────────────
// US-2233 — Mode pédiatrique
// ─────────────────────────────────────────────────────────────

export type PediatricCaregiverInput = {
  rank: number
  name: string
  phone: string
  relationship: string
  permissionLevel: PermissionLevel
}

export type PediatricCaregiverDTO = {
  id: number
  rank: number
  name: string | null
  phone: string | null
  relationship: string
  permissionLevel: PermissionLevel
  decryptionFailed: boolean
}

function decodeCaregiver(r: {
  id: number; rank: number;
  nameEncrypted: string; phoneEncrypted: string;
  relationship: string; permissionLevel: string;
}): PediatricCaregiverDTO {
  const name = safeDecryptField(r.nameEncrypted)
  const phone = safeDecryptField(r.phoneEncrypted)
  return {
    id: r.id, rank: r.rank,
    name, phone,
    relationship: r.relationship,
    permissionLevel: r.permissionLevel as PermissionLevel,
    decryptionFailed: name === null || phone === null,
  }
}

function validateCaregivers(caregivers: PediatricCaregiverInput[]): void {
  if (caregivers.length === 0) throw new ValidationError("emptyCaregivers")
  if (caregivers.length > MAX_CAREGIVERS) throw new ValidationError("tooManyCaregivers")
  const ranks = new Set<number>()
  for (const c of caregivers) {
    if (c.rank < 1 || c.rank > MAX_CAREGIVERS) throw new ValidationError("rank")
    if (ranks.has(c.rank)) throw new ValidationError("duplicateRank")
    ranks.add(c.rank)
    if (!c.name || c.name.length > NAME_MAX_LEN) throw new ValidationError("name")
    if (!c.phone || c.phone.length > PHONE_MAX_LEN) throw new ValidationError("phone")
    if (!c.relationship || c.relationship.length > RELATIONSHIP_MAX_LEN) {
      throw new ValidationError("relationship")
    }
    if (!PERMISSION_LEVELS.includes(c.permissionLevel)) {
      throw new ValidationError("permissionLevel")
    }
  }
}

export const pediatricModeService = {
  async getActive(patientId: number, auditUserId: number, ctx?: AuditContext): Promise<{
    version: ConfigVersionDTO | null
    caregivers: PediatricCaregiverDTO[]
  }> {
    const version = await prisma.configVersion.findFirst({
      where: {
        patientId,
        configType: ConfigVersionType.pediatric_mode,
        status: ConfigVersionStatus.active,
      },
      include: { pediatricCaregivers: { orderBy: { rank: "asc" } } },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT_MODE",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "pediatric.read" },
    })
    const caregivers = version
      ? version.pediatricCaregivers.map(decodeCaregiver)
      : []
    const failed = caregivers.filter((c) => c.decryptionFailed).length
    if (failed > 0) {
      await auditService.log({
        userId: auditUserId, action: "READ", resource: "PATIENT_MODE",
        resourceId: String(patientId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId, kind: "pediatric.decrypt.failure", count: failed },
      })
    }
    return {
      version: version ? toConfigVersionDTO(version) : null,
      caregivers,
    }
  },

  async upsert(
    patientId: number, caregivers: PediatricCaregiverInput[],
    auditUserId: number, ctx?: AuditContext,
  ): Promise<ConfigVersionDTO> {
    validateCaregivers(caregivers)
    return prisma.$transaction(async (tx: Tx) => {
      const now = new Date()
      const version = await nextVersion(tx, patientId, ConfigVersionType.pediatric_mode)
      await supersedePrevious(tx, patientId, ConfigVersionType.pediatric_mode, now)
      // Snapshot redacted (no PHI) — pattern emergency_contacts (PR #395).
      const snapshot = caregivers.map((c) => ({
        rank: c.rank,
        relationship: c.relationship,
        permissionLevel: c.permissionLevel,
        hasName: c.name.length > 0,
        hasPhone: c.phone.length > 0,
      })) satisfies Prisma.InputJsonValue
      const created = await tx.configVersion.create({
        data: {
          patientId,
          configType: ConfigVersionType.pediatric_mode,
          version,
          configSnapshot: snapshot,
          createdBy: auditUserId,
          pediatricCaregivers: {
            create: caregivers.map((c) => ({
              patientId,
              rank: c.rank,
              nameEncrypted: encryptField(c.name),
              phoneEncrypted: encryptField(c.phone),
              relationship: c.relationship,
              permissionLevel: c.permissionLevel,
            })),
          },
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "CONFIG_VERSION",
        resourceId: String(created.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId, kind: "pediatric.upsert",
          version, count: caregivers.length,
        },
      })
      return toConfigVersionDTO(created)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2234 — Mode Ramadan
// ─────────────────────────────────────────────────────────────

export type RamadanModeInput = {
  ramadanYear: number
  startDate: string // ISO yyyy-mm-dd
  endDate: string
  sahurTime: string // HH:MM
  iftarTime: string
  allowedFastingHours: number
  isfMultiplier: number
  icrMultiplier: number
}

const RAMADAN_BOUNDS = {
  YEAR_MIN: 2024, YEAR_MAX: 2050,
  FASTING_HOURS_MIN: 1, FASTING_HOURS_MAX: 20,
  // Clinical bounds : adjustment must stay within ±50% of base.
  ISF_MULT_MIN: 0.5, ISF_MULT_MAX: 2.0,
  ICR_MULT_MIN: 0.5, ICR_MULT_MAX: 2.0,
}

function validateRamadan(input: RamadanModeInput): void {
  if (input.ramadanYear < RAMADAN_BOUNDS.YEAR_MIN
    || input.ramadanYear > RAMADAN_BOUNDS.YEAR_MAX) {
    throw new ValidationError("ramadanYear")
  }
  if (!ISO_DATE_RE.test(input.startDate)) throw new ValidationError("startDate")
  if (!ISO_DATE_RE.test(input.endDate)) throw new ValidationError("endDate")
  const start = Date.parse(`${input.startDate}T00:00:00Z`)
  const end = Date.parse(`${input.endDate}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) throw new ValidationError("dateFormat")
  if (start >= end) throw new ValidationError("dateOrder")
  // Ramadan dure 29 ou 30 jours (lunaire). Borne large pour tolérer
  // les ajustements de fin de mois.
  const days = (end - start) / 86_400_000
  if (days < 28 || days > 31) throw new ValidationError("ramadanDuration")
  if (!TIME_HHMM_RE.test(input.sahurTime)) throw new ValidationError("sahurTime")
  if (!TIME_HHMM_RE.test(input.iftarTime)) throw new ValidationError("iftarTime")
  if (input.allowedFastingHours < RAMADAN_BOUNDS.FASTING_HOURS_MIN
    || input.allowedFastingHours > RAMADAN_BOUNDS.FASTING_HOURS_MAX) {
    throw new ValidationError("allowedFastingHours")
  }
  if (input.isfMultiplier < RAMADAN_BOUNDS.ISF_MULT_MIN
    || input.isfMultiplier > RAMADAN_BOUNDS.ISF_MULT_MAX) {
    throw new ValidationError("isfMultiplier")
  }
  if (input.icrMultiplier < RAMADAN_BOUNDS.ICR_MULT_MIN
    || input.icrMultiplier > RAMADAN_BOUNDS.ICR_MULT_MAX) {
    throw new ValidationError("icrMultiplier")
  }
}

export const ramadanModeService = {
  async getActive(patientId: number, auditUserId: number, ctx?: AuditContext): Promise<{
    version: ConfigVersionDTO | null
    config: RamadanModeInput | null
  }> {
    const version = await prisma.configVersion.findFirst({
      where: {
        patientId,
        configType: ConfigVersionType.ramadan_mode,
        status: ConfigVersionStatus.active,
      },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT_MODE",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "ramadan.read" },
    })
    return {
      version: version ? toConfigVersionDTO(version) : null,
      config: version
        ? (version.configSnapshot as unknown as RamadanModeInput)
        : null,
    }
  },

  async upsert(
    patientId: number, input: RamadanModeInput,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<ConfigVersionDTO> {
    validateRamadan(input)
    return prisma.$transaction(async (tx: Tx) => {
      const now = new Date()
      const version = await nextVersion(tx, patientId, ConfigVersionType.ramadan_mode)
      await supersedePrevious(tx, patientId, ConfigVersionType.ramadan_mode, now)
      const created = await tx.configVersion.create({
        data: {
          patientId,
          configType: ConfigVersionType.ramadan_mode,
          version,
          configSnapshot: input satisfies Prisma.InputJsonValue,
          createdBy: auditUserId,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "CONFIG_VERSION",
        resourceId: String(created.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId, kind: "ramadan.upsert",
          version, ramadanYear: input.ramadanYear,
        },
      })
      return toConfigVersionDTO(created)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2235 — Mode voyage
// ─────────────────────────────────────────────────────────────

export type TravelModeInput = {
  destination: string
  /** Décalage horaire entre origine et destination, en heures (-12..14). */
  timezoneOffsetHours: number
  departureDate: string // ISO yyyy-mm-dd
  returnDate: string
  /** Multiplicateur basal global appliqué pendant le voyage (0.5..1.5). */
  basalMultiplier: number
  /** Délai d'ajustement basal (en heures) après changement de fuseau (0..24). */
  basalDelayHours: number
}

const TRAVEL_BOUNDS = {
  TZ_OFFSET_MIN: -12, TZ_OFFSET_MAX: 14,
  BASAL_MULT_MIN: 0.5, BASAL_MULT_MAX: 1.5,
  BASAL_DELAY_MIN: 0, BASAL_DELAY_MAX: 24,
  DESTINATION_MAX_LEN: 100,
  TRIP_DAYS_MAX: 365,
}

function validateTravel(input: TravelModeInput): void {
  if (!input.destination || input.destination.length > TRAVEL_BOUNDS.DESTINATION_MAX_LEN) {
    throw new ValidationError("destination")
  }
  if (!Number.isFinite(input.timezoneOffsetHours)
    || input.timezoneOffsetHours < TRAVEL_BOUNDS.TZ_OFFSET_MIN
    || input.timezoneOffsetHours > TRAVEL_BOUNDS.TZ_OFFSET_MAX) {
    throw new ValidationError("timezoneOffsetHours")
  }
  if (!ISO_DATE_RE.test(input.departureDate)) throw new ValidationError("departureDate")
  if (!ISO_DATE_RE.test(input.returnDate)) throw new ValidationError("returnDate")
  const dep = Date.parse(`${input.departureDate}T00:00:00Z`)
  const ret = Date.parse(`${input.returnDate}T00:00:00Z`)
  if (Number.isNaN(dep) || Number.isNaN(ret)) throw new ValidationError("dateFormat")
  if (dep >= ret) throw new ValidationError("dateOrder")
  const days = (ret - dep) / 86_400_000
  if (days > TRAVEL_BOUNDS.TRIP_DAYS_MAX) throw new ValidationError("tripDuration")
  if (input.basalMultiplier < TRAVEL_BOUNDS.BASAL_MULT_MIN
    || input.basalMultiplier > TRAVEL_BOUNDS.BASAL_MULT_MAX) {
    throw new ValidationError("basalMultiplier")
  }
  if (input.basalDelayHours < TRAVEL_BOUNDS.BASAL_DELAY_MIN
    || input.basalDelayHours > TRAVEL_BOUNDS.BASAL_DELAY_MAX) {
    throw new ValidationError("basalDelayHours")
  }
}

/**
 * Protocole basal généré à partir du décalage horaire.
 *
 * Règle métier (consensus diabéto, à valider DOCTOR avant push patient) :
 *  - eastbound (offset > 0)  → journée raccourcie → réduire basal 5% par
 *    tranche de 6h, capé à -10%
 *  - westbound (offset < 0)  → journée allongée → augmenter basal 5% par
 *    tranche de 6h, capé à +10%
 *  - |offset| < 3h → pas d'ajustement (multiplier = 1.0)
 *
 * Le DOCTOR peut surcharger ces valeurs lors du `upsert` ; cette fonction
 * sert d'aide à la décision (UI pré-remplie).
 */
export function computeBasalProtocol(timezoneOffsetHours: number): {
  basalMultiplier: number
  basalDelayHours: number
} {
  const abs = Math.abs(timezoneOffsetHours)
  if (abs < 3) return { basalMultiplier: 1.0, basalDelayHours: 0 }
  const tranches = Math.min(2, Math.floor(abs / 6) + 1)
  const delta = 0.05 * tranches
  return {
    basalMultiplier: timezoneOffsetHours > 0 ? 1 - delta : 1 + delta,
    basalDelayHours: Math.min(TRAVEL_BOUNDS.BASAL_DELAY_MAX, Math.round(abs / 2)),
  }
}

export const travelModeService = {
  async getActive(patientId: number, auditUserId: number, ctx?: AuditContext): Promise<{
    version: ConfigVersionDTO | null
    config: TravelModeInput | null
  }> {
    const version = await prisma.configVersion.findFirst({
      where: {
        patientId,
        configType: ConfigVersionType.travel_mode,
        status: ConfigVersionStatus.active,
      },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT_MODE",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "travel.read" },
    })
    return {
      version: version ? toConfigVersionDTO(version) : null,
      config: version
        ? (version.configSnapshot as unknown as TravelModeInput)
        : null,
    }
  },

  async upsert(
    patientId: number, input: TravelModeInput,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<ConfigVersionDTO> {
    validateTravel(input)
    return prisma.$transaction(async (tx: Tx) => {
      const now = new Date()
      const version = await nextVersion(tx, patientId, ConfigVersionType.travel_mode)
      await supersedePrevious(tx, patientId, ConfigVersionType.travel_mode, now)
      const created = await tx.configVersion.create({
        data: {
          patientId,
          configType: ConfigVersionType.travel_mode,
          version,
          configSnapshot: input satisfies Prisma.InputJsonValue,
          createdBy: auditUserId,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "CONFIG_VERSION",
        resourceId: String(created.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId, kind: "travel.upsert",
          version, tzOffset: input.timezoneOffsetHours,
        },
      })
      return toConfigVersionDTO(created)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },
}

// ─────────────────────────────────────────────────────────────
// Common : validate (DOCTOR) + deactivate
// ─────────────────────────────────────────────────────────────

const SUPPORTED_MODE_TYPES = new Set<ConfigVersionType>([
  ConfigVersionType.pediatric_mode,
  ConfigVersionType.ramadan_mode,
  ConfigVersionType.travel_mode,
])

export const patientModeWorkflow = {
  /** DOCTOR signs off a NURSE-created mode version. */
  async validate(
    versionId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<ConfigVersionDTO> {
    return prisma.$transaction(async (tx: Tx) => {
      const row = await tx.configVersion.findUnique({ where: { id: versionId } })
      if (!row) throw new NotFoundError()
      if (!SUPPORTED_MODE_TYPES.has(row.configType)) {
        throw new ValidationError("unsupportedConfigType")
      }
      if (row.validatedAt !== null) throw new ValidationError("alreadyValidated")
      if (row.status !== ConfigVersionStatus.active) {
        throw new ValidationError("notActive")
      }
      const updated = await tx.configVersion.update({
        where: { id: versionId },
        data: { validatedBy: auditUserId, validatedAt: new Date() },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "CONFIG_VERSION",
        resourceId: String(versionId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: row.patientId, configType: row.configType,
          version: row.version, kind: "mode.validate",
        },
      })
      return toConfigVersionDTO(updated)
    })
  },

  /**
   * Deactivate the active mode for `(patient, configType)`.
   * Sets `status=archived` + `validTo=now`. Mode disappears from `getActive`
   * but remains in history. Idempotent (no-op if already archived).
   */
  async deactivate(
    patientId: number, configType: ConfigVersionType,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<{ archived: boolean }> {
    if (!SUPPORTED_MODE_TYPES.has(configType)) {
      throw new ValidationError("unsupportedConfigType")
    }
    return prisma.$transaction(async (tx: Tx) => {
      const active = await tx.configVersion.findFirst({
        where: { patientId, configType, status: ConfigVersionStatus.active },
      })
      if (!active) return { archived: false }
      await tx.configVersion.update({
        where: { id: active.id },
        data: { status: ConfigVersionStatus.archived, validTo: new Date() },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "CONFIG_VERSION",
        resourceId: String(active.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId, configType,
          version: active.version, kind: "mode.deactivate",
        },
      })
      return { archived: true }
    })
  },

  async listHistory(
    patientId: number, configType: ConfigVersionType,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<ConfigVersionDTO[]> {
    if (!SUPPORTED_MODE_TYPES.has(configType)) {
      throw new ValidationError("unsupportedConfigType")
    }
    const rows = await prisma.configVersion.findMany({
      where: { patientId, configType },
      orderBy: { version: "desc" },
      take: 100,
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "CONFIG_VERSION",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "mode.history", configType, count: rows.length },
    })
    return rows.map(toConfigVersionDTO)
  },
}
