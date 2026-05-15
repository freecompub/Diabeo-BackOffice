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
 * ⚠️ CLINICAL DISCLAIMER (medical-domain-validator C2) ⚠️
 *
 * Mode configs are **informational only** in this PR : `insulin.service.ts`
 * does NOT yet read `isfMultiplier`, `icrMultiplier`, or `basalMultiplier`
 * during bolus/basal calculation. DOCTOR review remains mandatory at
 * `validate` step, and the UI MUST surface a "Adjustments are manual —
 * automated dose adaptation not yet implemented" banner. Wiring into the
 * insulin calculator is tracked as a follow-up US (modes → calculator
 * integration with re-validation of CLINICAL_BOUNDS post-multiplier).
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
import { z } from "zod"
import { prisma, type PrismaClientOrTx as Tx } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { auditService, type AuditContext } from "./audit.service"
import { NotFoundError, ValidationError } from "./team-workflow.errors"

// ─────────────────────────────────────────────────────────────
// Shared helpers (mirror mirror-v1-config.service patterns)
// ─────────────────────────────────────────────────────────────

// Medical H1 — renamed "config" → "propose" : caregivers cannot mutate
// clinical thresholds directly. "propose" grants the right to create a
// pending AdjustmentProposal that still requires DOCTOR review (per HAS
// pediatric T1D guidelines + ISPAD 2022 §13). UI must not expose
// threshold-write controls to "propose"-only caregivers.
const PERMISSION_LEVELS = ["read", "write", "propose"] as const
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number]

/**
 * Soft warnings surfaced from validation. They do NOT block the operation
 * but are logged in audit metadata and returned to callers so the DOCTOR
 * can acknowledge them at `validate` time.
 */
export type ModeWarning = {
  code:
    | "extendedFasting"        // Ramadan > 16h (IDF-DAR 2021 §6.4)
    | "basalAdjustmentLarge"   // travel basal multiplier > ±20%
    | "basalDelayLong"         // travel delay > 8h
    | "ramadanShortMonth"      // Ramadan = 29 days (acceptable, FYI)
  severity: "info" | "warning"
}

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

/**
 * L2 (re-review C, post-merge) — DRY helper used by all 3 mode upserts.
 * Wraps the Serializable transaction, nextVersion+supersede, ConfigVersion
 * insert (with optional child rows via `extraCreate`), and audit emission.
 *
 * `auditKind` flows into `metadata.kind` for forensic filtering (e.g.
 * "ramadan.upsert"). `extraCreate` is folded into `configVersion.create.data`
 * so callers (only pediatric today) can add nested `pediatricCaregivers.create`.
 *
 * Returns a `ConfigVersionDTO` ; callers wrap with their own `warnings`.
 */
// Groupe 10 Batch D — exported for reuse by third-party-share + shared-
//   notifications services (US-2240, US-2242).
//
// M3 (re-review) — `extraCreate` carries nested writes (e.g. pediatric
// caregivers) and is sensitive : only `pediatric_mode` is allowed to use
// it. Other config types passing `extraCreate` are rejected at runtime
// to avoid PHI relationship leaks via copy-paste.
export async function createConfigVersion(args: {
  patientId: number
  configType: ConfigVersionType
  snapshot: Prisma.InputJsonValue
  auditUserId: number
  ctx?: AuditContext
  auditKind: string
  auditExtra?: Record<string, unknown>
  extraCreate?: Partial<Prisma.ConfigVersionUncheckedCreateInput>
}): Promise<ConfigVersionDTO> {
  if (args.extraCreate && args.configType !== ConfigVersionType.pediatric_mode) {
    throw new Error(
      `createConfigVersion: extraCreate is only allowed for pediatric_mode (got ${args.configType})`,
    )
  }
  return prisma.$transaction(async (tx: Tx) => {
    const now = new Date()
    const version = await nextVersion(tx, args.patientId, args.configType)
    await supersedePrevious(tx, args.patientId, args.configType, now)
    const created = await tx.configVersion.create({
      data: {
        patientId: args.patientId,
        configType: args.configType,
        version,
        configSnapshot: args.snapshot,
        createdBy: args.auditUserId,
        ...args.extraCreate,
      },
    })
    await auditService.logWithTx(tx, {
      userId: args.auditUserId, action: "CREATE", resource: "CONFIG_VERSION",
      resourceId: String(created.id),
      ipAddress: args.ctx?.ipAddress, userAgent: args.ctx?.userAgent, requestId: args.ctx?.requestId,
      metadata: {
        patientId: args.patientId, kind: args.auditKind,
        version, ...args.auditExtra,
      },
    })
    return toConfigVersionDTO(created)
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
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
  ): Promise<{ version: ConfigVersionDTO; warnings: ModeWarning[] }> {
    validateCaregivers(caregivers)
    // L3 (re-review C, post-merge) — consistent return shape across modes :
    //   `{ version, warnings }` even when pediatric emits no soft warnings.
    // L2 — uses shared `createConfigVersion` helper.
    const snapshot = caregivers.map((c) => ({
      rank: c.rank,
      relationship: c.relationship,
      permissionLevel: c.permissionLevel,
      hasName: c.name.length > 0,
      hasPhone: c.phone.length > 0,
    })) satisfies Prisma.InputJsonValue
    const version = await createConfigVersion({
      patientId,
      configType: ConfigVersionType.pediatric_mode,
      snapshot,
      auditUserId, ctx,
      auditKind: "pediatric.upsert",
      auditExtra: { count: caregivers.length },
      extraCreate: {
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
      } as Partial<Prisma.ConfigVersionUncheckedCreateInput>,
    })
    return { version, warnings: [] }
  },
}

// ─────────────────────────────────────────────────────────────
// US-2234 — Mode Ramadan
// ─────────────────────────────────────────────────────────────

/**
 * Code-review H2 — Zod schema as the single source of truth for the
 * Ramadan snapshot shape ; used to parse `configSnapshot` on read so a
 * corrupted JSONB row degrades gracefully (returns null + audit) instead
 * of silently emitting undefined to the calculator.
 */
export const ramadanSnapshotSchema = z.object({
  ramadanYear: z.number(),
  startDate: z.string(),
  endDate: z.string(),
  sahurTime: z.string(),
  iftarTime: z.string(),
  allowedFastingHours: z.number(),
  isfMultiplier: z.number(),
  icrMultiplier: z.number(),
})

export type RamadanModeInput = z.infer<typeof ramadanSnapshotSchema>

const RAMADAN_BOUNDS = {
  YEAR_MIN: 2024, YEAR_MAX: 2050,
  FASTING_HOURS_MIN: 1, FASTING_HOURS_MAX: 20,
  /** Medical H3 — > 16h fasting raises an `extendedFasting` warning. */
  FASTING_HOURS_WARN: 16,
  /** Medical L1 — lunar Ramadan is always 29 or 30 days. */
  DURATION_MIN_DAYS: 29, DURATION_MAX_DAYS: 30,
  /** ±50% of base ISF/ICR (DOCTOR can downscale further). */
  ISF_MULT_MIN: 0.5, ISF_MULT_MAX: 2.0,
  ICR_MULT_MIN: 0.5, ICR_MULT_MAX: 2.0,
} as const

/**
 * Compute fasting hours from `sahurTime` → `iftarTime` (wrapping past
 * midnight if needed). Used by L2 sanity check (consistency with the
 * declared `allowedFastingHours`).
 */
function computeFastingHours(sahur: string, iftar: string): number {
  const [sh, sm] = sahur.split(":").map(Number) as [number, number]
  const [ih, im] = iftar.split(":").map(Number) as [number, number]
  const sahurMin = sh * 60 + sm
  const iftarMin = ih * 60 + im
  let diff = iftarMin - sahurMin
  if (diff <= 0) diff += 24 * 60
  return diff / 60
}

function validateRamadan(input: RamadanModeInput): ModeWarning[] {
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
  // Medical L1 — lunar Ramadan is always 29 or 30 days (moon-sighting
  // variance ±1d ; 28 or 31-day months don't occur naturally).
  const days = (end - start) / 86_400_000
  if (days < RAMADAN_BOUNDS.DURATION_MIN_DAYS
    || days > RAMADAN_BOUNDS.DURATION_MAX_DAYS) {
    throw new ValidationError("ramadanDuration")
  }
  if (!TIME_HHMM_RE.test(input.sahurTime)) throw new ValidationError("sahurTime")
  if (!TIME_HHMM_RE.test(input.iftarTime)) throw new ValidationError("iftarTime")
  if (input.allowedFastingHours < RAMADAN_BOUNDS.FASTING_HOURS_MIN
    || input.allowedFastingHours > RAMADAN_BOUNDS.FASTING_HOURS_MAX) {
    throw new ValidationError("allowedFastingHours")
  }
  // Medical L2 — sahur → iftar window must roughly match allowedFastingHours
  //   (tolerate ±1.5h for travel time between locales).
  const fastingFromTimes = computeFastingHours(input.sahurTime, input.iftarTime)
  if (Math.abs(fastingFromTimes - input.allowedFastingHours) > 1.5) {
    throw new ValidationError("fastingWindowMismatch")
  }
  if (input.isfMultiplier < RAMADAN_BOUNDS.ISF_MULT_MIN
    || input.isfMultiplier > RAMADAN_BOUNDS.ISF_MULT_MAX) {
    throw new ValidationError("isfMultiplier")
  }
  if (input.icrMultiplier < RAMADAN_BOUNDS.ICR_MULT_MIN
    || input.icrMultiplier > RAMADAN_BOUNDS.ICR_MULT_MAX) {
    throw new ValidationError("icrMultiplier")
  }

  // Soft warnings (Medical H3 / IDF-DAR 2021 §6.4).
  const warnings: ModeWarning[] = []
  if (input.allowedFastingHours > RAMADAN_BOUNDS.FASTING_HOURS_WARN) {
    warnings.push({ code: "extendedFasting", severity: "warning" })
  }
  if (days === RAMADAN_BOUNDS.DURATION_MIN_DAYS) {
    warnings.push({ code: "ramadanShortMonth", severity: "info" })
  }
  return warnings
}

export const ramadanModeService = {
  async getActive(patientId: number, auditUserId: number, ctx?: AuditContext): Promise<{
    version: ConfigVersionDTO | null
    config: RamadanModeInput | null
    /** Code-review H2 — true when configSnapshot failed Zod validation. */
    snapshotInvalid: boolean
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
    let config: RamadanModeInput | null = null
    let snapshotInvalid = false
    if (version) {
      const parsed = ramadanSnapshotSchema.safeParse(version.configSnapshot)
      if (parsed.success) {
        config = parsed.data
      } else {
        snapshotInvalid = true
        await auditService.log({
          userId: auditUserId, action: "READ", resource: "PATIENT_MODE",
          resourceId: String(patientId),
          ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
          metadata: { patientId, kind: "ramadan.snapshot.invalid", versionId: version.id },
        })
      }
    }
    return {
      version: version ? toConfigVersionDTO(version) : null,
      config,
      snapshotInvalid,
    }
  },

  async upsert(
    patientId: number, input: RamadanModeInput,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<{ version: ConfigVersionDTO; warnings: ModeWarning[] }> {
    const warnings = validateRamadan(input)
    const version = await createConfigVersion({
      patientId,
      configType: ConfigVersionType.ramadan_mode,
      snapshot: input satisfies Prisma.InputJsonValue,
      auditUserId, ctx,
      auditKind: "ramadan.upsert",
      auditExtra: {
        ramadanYear: input.ramadanYear,
        warnings: warnings.map((w) => w.code),
      },
    })
    return { version, warnings }
  },
}

// ─────────────────────────────────────────────────────────────
// US-2235 — Mode voyage
// ─────────────────────────────────────────────────────────────

/**
 * Code-review H2 — Zod schema as the single source of truth for the
 * Travel snapshot shape.
 */
export const travelSnapshotSchema = z.object({
  destination: z.string(),
  /** Décalage horaire entre origine et destination, en heures (-12..14). */
  timezoneOffsetHours: z.number(),
  departureDate: z.string(),
  returnDate: z.string(),
  /** Multiplicateur basal pendant la fenêtre de transition (0.7..1.3). */
  basalMultiplier: z.number(),
  /** Délai d'ajustement basal (en heures) après changement de fuseau (0..12). */
  basalDelayHours: z.number(),
})

export type TravelModeInput = z.infer<typeof travelSnapshotSchema>

const TRAVEL_BOUNDS = {
  TZ_OFFSET_MIN: -12, TZ_OFFSET_MAX: 14,
  /** Medical M1 — tightened from ±50% to ±30% (ATTD/EASD 2022 consensus). */
  BASAL_MULT_MIN: 0.7, BASAL_MULT_MAX: 1.3,
  /** Medical M1 — warn above ±20% (typical adjustment, AACE Pump Position). */
  BASAL_MULT_WARN_MIN: 0.8, BASAL_MULT_WARN_MAX: 1.2,
  /** Medical M2 — tightened from 24h to 12h (typical 2-6h). */
  BASAL_DELAY_MIN: 0, BASAL_DELAY_MAX: 12,
  BASAL_DELAY_WARN: 8,
  DESTINATION_MAX_LEN: 100,
  TRIP_DAYS_MAX: 365,
} as const

function validateTravel(input: TravelModeInput): ModeWarning[] {
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

  // Soft warnings (Medical M1 / M2).
  const warnings: ModeWarning[] = []
  if (input.basalMultiplier < TRAVEL_BOUNDS.BASAL_MULT_WARN_MIN
    || input.basalMultiplier > TRAVEL_BOUNDS.BASAL_MULT_WARN_MAX) {
    warnings.push({ code: "basalAdjustmentLarge", severity: "warning" })
  }
  if (input.basalDelayHours > TRAVEL_BOUNDS.BASAL_DELAY_WARN) {
    warnings.push({ code: "basalDelayLong", severity: "warning" })
  }
  return warnings
}

/**
 * Protocole basal généré à partir du décalage horaire.
 *
 * Règle métier (ATTD/EASD travel consensus 2022 ; AACE Pump Therapy
 * Position Statement). L'ajustement n'est appliqué que pendant la fenêtre
 * de transition (acclimatation circadienne, ~24-48h post-arrivée), pas
 * pendant tout le séjour (medical C1 — corrige une erreur clinique).
 *
 *  - eastbound (offset > 0)  → journée raccourcie → réduire basal pendant
 *    la fenêtre de transition (5% par tranche de 6h, capé à -10%)
 *  - westbound (offset < 0)  → journée allongée → augmenter basal pendant
 *    la fenêtre de transition (+5% par tranche de 6h, capé à +10%)
 *  - |offset| < 3h → pas d'ajustement
 *
 * Le retour est UNE PROPOSITION ; `requiresDoctorReview: true` toujours
 * vrai, le DOCTOR doit relire avant `upsert`.
 *
 * Cap formula : `Math.min(2, Math.ceil(abs / 6))` — 1 tranche pour [3, 6h],
 * 2 tranches pour [6, 12h], capé à 2 (10%) au-delà (medical M4 + code-review
 * C1 — corrige l'off-by-one sur l'ancienne formule).
 */
export function computeBasalProtocol(timezoneOffsetHours: number): {
  basalMultiplier: number
  basalDelayHours: number
  /** Durée de la fenêtre de transition pendant laquelle appliquer le multiplier. */
  transitionWindowHours: number
  /** Toujours `true` — le DOCTOR doit valider avant push patient. */
  requiresDoctorReview: true
  /** Source clinique pour traçabilité. */
  reference: "ATTD-EASD-2022"
} {
  const abs = Math.abs(timezoneOffsetHours)
  if (abs < 3) {
    return {
      basalMultiplier: 1.0,
      basalDelayHours: 0,
      transitionWindowHours: 0,
      requiresDoctorReview: true,
      reference: "ATTD-EASD-2022",
    }
  }
  const tranches = Math.min(2, Math.ceil(abs / 6))
  const delta = 0.05 * tranches
  return {
    basalMultiplier: timezoneOffsetHours > 0 ? 1 - delta : 1 + delta,
    basalDelayHours: Math.min(TRAVEL_BOUNDS.BASAL_DELAY_MAX, Math.round(abs / 3)),
    // Transition window : ~24h pour <6h offset, 48h pour ≥6h offset.
    transitionWindowHours: abs < 6 ? 24 : 48,
    requiresDoctorReview: true,
    reference: "ATTD-EASD-2022",
  }
}

export const travelModeService = {
  async getActive(patientId: number, auditUserId: number, ctx?: AuditContext): Promise<{
    version: ConfigVersionDTO | null
    config: TravelModeInput | null
    snapshotInvalid: boolean
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
    let config: TravelModeInput | null = null
    let snapshotInvalid = false
    if (version) {
      const parsed = travelSnapshotSchema.safeParse(version.configSnapshot)
      if (parsed.success) {
        config = parsed.data
      } else {
        snapshotInvalid = true
        await auditService.log({
          userId: auditUserId, action: "READ", resource: "PATIENT_MODE",
          resourceId: String(patientId),
          ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
          metadata: { patientId, kind: "travel.snapshot.invalid", versionId: version.id },
        })
      }
    }
    return {
      version: version ? toConfigVersionDTO(version) : null,
      config,
      snapshotInvalid,
    }
  },

  async upsert(
    patientId: number, input: TravelModeInput,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<{ version: ConfigVersionDTO; warnings: ModeWarning[] }> {
    const warnings = validateTravel(input)
    const version = await createConfigVersion({
      patientId,
      configType: ConfigVersionType.travel_mode,
      snapshot: input satisfies Prisma.InputJsonValue,
      auditUserId, ctx,
      auditKind: "travel.upsert",
      auditExtra: {
        tzOffset: input.timezoneOffsetHours,
        warnings: warnings.map((w) => w.code),
      },
    })
    return { version, warnings }
  },
}

// ─────────────────────────────────────────────────────────────
// Common : validate (DOCTOR) + deactivate
// ─────────────────────────────────────────────────────────────

// H2 (re-review) — workflow renommé `SUPPORTED_VERSIONED_CONFIG_TYPES`
//   pour refléter sa nature post-Batch D : pas uniquement des modes, mais
//   toute config patient-scoped versionnée (modes + partages + routing
//   notifications). Le `kind` audit est désormais dérivé du `configType`
//   pour distinguer correctement dans la forensique HDS
//   (ex. `pediatric_mode.validate` vs `third_party_share.validate`).
const SUPPORTED_VERSIONED_CONFIG_TYPES = new Set<ConfigVersionType>([
  ConfigVersionType.pediatric_mode,
  ConfigVersionType.ramadan_mode,
  ConfigVersionType.travel_mode,
  ConfigVersionType.third_party_share,
  ConfigVersionType.shared_notifications,
])
// Backward-compat alias for legacy callers (deprecated, will be removed in V2).
const SUPPORTED_MODE_TYPES = SUPPORTED_VERSIONED_CONFIG_TYPES

export const patientModeWorkflow = {
  /** DOCTOR signs off a NURSE-created mode version. */
  async validate(
    versionId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<ConfigVersionDTO> {
    // H1 (healthcare audit) — Serializable so concurrent DOCTOR validates
    //   surface cleanly as 409 (P2034) via mapErrorToResponse, instead of a
    //   500 from the immutability trigger firing on the second commit.
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
          version: row.version,
          // H2 (re-review) — kind derived from configType so forensic
          //   filters distinguish modes vs shares vs notifications.
          kind: `${row.configType}.validate`,
        },
      })
      return toConfigVersionDTO(updated)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
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
    // H1 (healthcare audit) — Serializable so concurrent deactivates collapse
    //   to a single update + audit row (no duplicate audit on the second tx).
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
          version: active.version,
          // H2 (re-review) — kind derived from configType.
          kind: `${configType}.deactivate`,
        },
      })
      return { archived: true }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
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
      // H2 (re-review) — kind derived from configType.
      metadata: { patientId, kind: `${configType}.history`, configType, count: rows.length },
    })
    return rows.map(toConfigVersionDTO)
  },
}
