/**
 * @module share-config.service
 * @description Groupe 10 Batch D — Partages tiers + notifications multi-aidants.
 *
 *  - US-2240 third_party_share (5 SP) — partage de données patient avec
 *    un tiers institutionnel (école, EHPAD, autre cabinet). NURSE crée
 *    draft, DOCTOR valide via `patientModeWorkflow.validate` existant.
 *  - US-2242 shared_notifications (3 SP) — matrice alertType × caregiver
 *    pour router les notifications.
 *
 * Réutilise le hub ConfigVersion (PR #396) + `createConfigVersion` helper
 * (exporté pour Batch D). Pas de nouvelle table : 2 valeurs enum ajoutées
 * via migration `20260515000000_groupe10_batch_d_shares_messaging`.
 */

import { z } from "zod"
import {
  ConfigVersionStatus,
  ConfigVersionType,
  Prisma,
} from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"
import {
  createConfigVersion,
  type ConfigVersionDTO,
} from "./patient-modes.service"

// ─────────────────────────────────────────────────────────────
// US-2240 — Third-party share
// ─────────────────────────────────────────────────────────────

/**
 * Snapshot Zod : on parse à la lecture pour graceful degradation si
 * une ligne JSONB est corrompue (code-review H2 pattern PR #396).
 */
export const thirdPartyShareSchema = z.object({
  /** Nom du destinataire (organisation/personne) — string libre, max 120c. */
  recipient: z.string().min(1).max(120),
  /** Type de destinataire : school, ehpad, external_cabinet, etc. */
  recipientType: z.enum(["school", "ehpad", "external_cabinet", "other"]),
  /** But du partage — texte libre, doc clinique. */
  purpose: z.string().min(1).max(500),
  /** Date d'expiration du partage. */
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export type ThirdPartyShareInput = z.infer<typeof thirdPartyShareSchema>

const SHARE_BOUNDS = {
  /** Le partage ne peut excéder N jours à partir d'aujourd'hui. */
  MAX_DURATION_DAYS: 365,
} as const

class ValidationError extends Error {
  field: string
  constructor(field: string) {
    super(field)
    this.field = field
  }
}

// M1 (re-review) — interpret `expiresAt` as **end-of-day Europe/Paris**
//   (23:59:59 local) so a doctor entering "today" in Paris (UTC+1/+2)
//   doesn't get spurious `expiresPast`. Live tz offset extracted via
//   Intl `longOffset` part to be DST-correct.
function validateThirdPartyShare(input: ThirdPartyShareInput): void {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
    timeZoneName: "longOffset",
  })
  // Probe the offset at the target date (handles DST near the boundary).
  const probe = new Date(`${input.expiresAt}T12:00:00Z`)
  const parts = fmt.formatToParts(probe)
  const offset = parts.find((p) => p.type === "timeZoneName")?.value
    ?.replace(/^GMT/, "") ?? "+00:00"
  const expires = Date.parse(`${input.expiresAt}T23:59:59${offset}`)
  if (Number.isNaN(expires)) throw new ValidationError("expiresAt")
  const now = Date.now()
  if (expires <= now) throw new ValidationError("expiresPast")
  const maxMs = SHARE_BOUNDS.MAX_DURATION_DAYS * 86_400_000
  if (expires - now > maxMs) throw new ValidationError("expiresTooFar")
}

export const thirdPartyShareService = {
  async getActive(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<{ version: ConfigVersionDTO | null; config: ThirdPartyShareInput | null; snapshotInvalid: boolean }> {
    const version = await prisma.configVersion.findFirst({
      where: {
        patientId,
        configType: ConfigVersionType.third_party_share,
        status: ConfigVersionStatus.active,
      },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "CONFIG_VERSION",
      resourceId: version ? String(version.id) : "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "third_party_share.read" },
    })
    if (!version) return { version: null, config: null, snapshotInvalid: false }
    const parsed = thirdPartyShareSchema.safeParse(version.configSnapshot)
    if (!parsed.success) {
      await auditService.log({
        userId: auditUserId, action: "READ", resource: "CONFIG_VERSION",
        resourceId: String(version.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId, kind: "third_party_share.snapshot.invalid", versionId: version.id },
      })
      return {
        version: toDTO(version), config: null, snapshotInvalid: true,
      }
    }
    return {
      version: toDTO(version), config: parsed.data, snapshotInvalid: false,
    }
  },

  async upsert(
    patientId: number, input: ThirdPartyShareInput,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<ConfigVersionDTO> {
    validateThirdPartyShare(input)
    return createConfigVersion({
      patientId,
      configType: ConfigVersionType.third_party_share,
      snapshot: input satisfies Prisma.InputJsonValue,
      auditUserId, ctx,
      auditKind: "third_party_share.upsert",
      auditExtra: {
        recipientType: input.recipientType,
        expiresAt: input.expiresAt,
      },
    })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2242 — Shared notifications (alertType × caregivers matrix)
// ─────────────────────────────────────────────────────────────

/**
 * Alert types pour lesquels la matrice est configurable. Sous-ensemble
 * de `EmergencyAlertType` côté schéma + types généraux.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used via `typeof ALERT_TYPES` in the type export below
const ALERT_TYPES = [
  "severe_hypo", "hypo", "severe_hyper", "hyper",
  "ketone_dka", "ketone_moderate", "manual",
] as const
export type SharedNotifAlertType = (typeof ALERT_TYPES)[number]

// M5 (re-review) — strict object schema with all 7 alertTypes as optional
//   arrays. Avoids Zod 3's `z.record(z.enum, …)` quirk that infers a full
//   (non-partial) Record. Unknown keys at parse time fall in `.strict()`
//   territory but we keep `.passthrough()=false` (default) so they're
//   silently stripped — acceptable since alertType is a known enum.
const caregiverArraySchema = z.array(z.number().int().positive()).max(20).optional()
export const sharedNotificationsSchema = z.object({
  routing: z.object({
    severe_hypo: caregiverArraySchema,
    hypo: caregiverArraySchema,
    severe_hyper: caregiverArraySchema,
    hyper: caregiverArraySchema,
    ketone_dka: caregiverArraySchema,
    ketone_moderate: caregiverArraySchema,
    manual: caregiverArraySchema,
  }).strict(),
})

export type SharedNotificationsInput = z.infer<typeof sharedNotificationsSchema>

export const sharedNotificationsService = {
  async getActive(
    patientId: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<{ version: ConfigVersionDTO | null; config: SharedNotificationsInput | null; snapshotInvalid: boolean }> {
    const version = await prisma.configVersion.findFirst({
      where: {
        patientId,
        configType: ConfigVersionType.shared_notifications,
        status: ConfigVersionStatus.active,
      },
    })
    await auditService.log({
      userId: auditUserId, action: "READ", resource: "CONFIG_VERSION",
      resourceId: version ? String(version.id) : "0",
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { patientId, kind: "shared_notifications.read" },
    })
    if (!version) return { version: null, config: null, snapshotInvalid: false }
    const parsed = sharedNotificationsSchema.safeParse(version.configSnapshot)
    if (!parsed.success) {
      await auditService.log({
        userId: auditUserId, action: "READ", resource: "CONFIG_VERSION",
        resourceId: String(version.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId, kind: "shared_notifications.snapshot.invalid", versionId: version.id },
      })
      return { version: toDTO(version), config: null, snapshotInvalid: true }
    }
    return { version: toDTO(version), config: parsed.data, snapshotInvalid: false }
  },

  async upsert(
    patientId: number, input: SharedNotificationsInput,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<ConfigVersionDTO> {
    // M5 (re-review) — caregiverId FK check : ensure every referenced User
    //   exists and is `active`. Prevents routing notifications to deleted/
    //   suspended accounts (silently dropped at runtime today).
    const allCaregiverIds = Array.from(new Set(
      Object.values(input.routing).flatMap((ids) => ids ?? []),
    ))
    if (allCaregiverIds.length > 0) {
      const known = await prisma.user.findMany({
        where: { id: { in: allCaregiverIds }, status: "active" },
        select: { id: true },
      })
      const knownIds = new Set(known.map((u) => u.id))
      const missing = allCaregiverIds.filter((id) => !knownIds.has(id))
      if (missing.length > 0) {
        throw new ValidationError(`unknownCaregiverIds:${missing.join(",")}`)
      }
    }
    return createConfigVersion({
      patientId,
      configType: ConfigVersionType.shared_notifications,
      snapshot: input satisfies Prisma.InputJsonValue,
      auditUserId, ctx,
      auditKind: "shared_notifications.upsert",
      auditExtra: {
        alertTypesConfigured: Object.keys(input.routing).length,
        caregiverCount: allCaregiverIds.length,
      },
    })
  },
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function toDTO(r: {
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

export { ValidationError as ShareValidationError }
