/**
 * @module emergency.service
 * @description US-2224/2225/2226/2230 — Emergency alert workflow.
 *
 *  - US-2224: list/create alerts (inbox, scoped to caller's portfolio).
 *  - US-2225: timeline (CGM context window around the trigger).
 *  - US-2226: doctor reaction workflow (acknowledge / resolve / actions).
 *  - US-2230: real-time push via FCM (high-priority + deep link).
 *
 * Detection relies on CgmObjective (US-2214 thresholds) + AlertThresholdConfig
 * (US-2215 emission rules) + KetoneThreshold (US-2216).
 *
 * **Boundary semantics (clinical safety)**:
 *  - Severe hypo: glucose ≤ veryLow (54 mg/dL by default — ADA SoC 2024).
 *  - Hypo:        veryLow < glucose < low (54 < g < 70).
 *  - Hyper:       ok < glucose < high (180 < g < 250).
 *  - Severe hyper: glucose ≥ high (≥ 250 mg/dL).
 *  - Ketone DKA: ≥ dkaThreshold (3.0 mmol/L — ISPAD 2022 criterion).
 *
 * **Severity-aware cooldown**: critical alerts (severe_hypo, severe_hyper,
 * ketone_dka) re-fire after at most 15 min regardless of cooldownMinutes,
 * so a deteriorating Level 2 hypo is not silenced.
 *
 * **Concurrency**: a partial unique index `(patientId, alertType, status)`
 * prevents duplicate live alerts. Service catches P2002 from prisma and
 * treats it as cooldown hit. The serialized check + insert is best-effort
 * but the DB constraint is the source of truth.
 *
 * **Encryption (RGPD Art. 9 + HDS)**:
 *  - notes / resolutionNotes / contextSnapshot encrypted at rest with
 *    AES-256-GCM via encryptField.
 *  - action.notes encrypted similarly.
 *  - action.metadata strictly bounded — no PII.
 *
 * Bolus suggestions are NEVER auto-injected — the doctor workflow only
 * documents actions, audit trail, and patient notification.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { auditService } from "./audit.service"
import { fcmService } from "./fcm.service"
import { emailService } from "./email.service"
import { logger } from "@/lib/logger"
import { ALERT_THRESHOLD_DEFAULTS } from "./alert-threshold.service"
import { getCgmDefaults } from "./objectives.service"
import type { AuditContext } from "./patient.service"
import type {
  EmergencyAlertType,
  EmergencyAlertSeverity,
  EmergencyAlertStatus,
  EmergencyAlertActionType,
} from "@prisma/client"

/** Window (minutes) of CGM context captured for timeline (US-2225). */
const CONTEXT_WINDOW_MINUTES = 30

/** Maximum CGM points snapshotted with the alert (cap memory). */
const CONTEXT_MAX_POINTS = 50

/** Maximum bulk page size for inbox. */
const MAX_LIST_LIMIT = 100

/** mg/dL ↔ g/L conversion factor. */
const GL_TO_MGDL = 100

/** Severity-aware cooldown ceiling (minutes). Critical never silenced > 15 min. */
const CRITICAL_COOLDOWN_CEILING = 15

/**
 * Hard timeout per dispatch channel (FCM / email). A slow provider must not
 * inflate API request latency on the CGM-ingestion critical path.
 * 5 s is a safe upper bound: Resend p95 is < 1 s, FCM p95 < 500 ms.
 */
const DISPATCH_TIMEOUT_MS = 5_000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race<T>([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_timeout`)), ms),
    ),
  ])
}

/**
 * Sanity bounds on alert trigger values — sensor errors above these ranges
 * should never be persisted. Mirrors CGM ingestion validation.
 */
const GLUCOSE_BOUNDS = { MIN: 40, MAX: 600 } as const
const KETONE_BOUNDS = { MIN: 0.1, MAX: 10 } as const

/**
 * Name of the partial unique index on (patient_id, alert_type) WHERE
 * status IN ('open','acknowledged'). See prisma/sql/emergency_alerts_constraints.sql.
 * Used to narrow P2002 catching to *this* invariant — any other future
 * unique-constraint violation must propagate.
 */
const LIVE_ALERT_UNIQUE_INDEX = "emergency_alerts_one_live_per_type"

interface DetectFromCgmInput {
  patientId: number
  glucoseValueMgdl: number
  triggeredAt?: Date
}

interface DetectFromKetoneInput {
  patientId: number
  ketoneValueMmol: number
  triggeredAt?: Date
}

interface CreateManualAlertInput {
  patientId: number
  severity: EmergencyAlertSeverity
  notes?: string
  /** Caller's role — required to gate critical-severity manual alerts. */
  callerRole: "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"
}

export interface EmergencyAlertListFilter {
  status?: EmergencyAlertStatus[]
  severity?: EmergencyAlertSeverity[]
  alertType?: EmergencyAlertType[]
  from?: Date
  to?: Date
  patientId?: number
  /** Caller's accessible patient IDs (RBAC scoping). Required for non-ADMIN. */
  scopePatientIds?: number[] | null
  limit?: number
  cursor?: number
}

interface AlertActionInput {
  alertId: number
  performedBy: number
  actionType: EmergencyAlertActionType
  notes?: string
  /** Strict shape — durationSec / outcome only. No PHI/PII allowed. */
  metadata?: { durationSec?: number; outcome?: string }
}

export interface CgmSnapshotPoint {
  ts: string
  mgdl: number
}

/**
 * Map CGM value (mg/dL) + per-patient thresholds to alert type & severity.
 * Boundary semantics use ≤ (severe_hypo / severe_hyper) and < (hypo / hyper).
 * Returns null if no threshold breached.
 */
function classifyCgmAlert(
  glucoseMgdl: number,
  thresholds: { veryLowMgdl: number; lowMgdl: number; okMgdl: number; highMgdl: number },
  rules: {
    alertOnHypo: boolean
    alertOnSevereHypo: boolean
    alertOnHyper: boolean
    alertOnSevereHyper: boolean
  },
): { type: EmergencyAlertType; severity: EmergencyAlertSeverity } | null {
  if (glucoseMgdl <= thresholds.veryLowMgdl && rules.alertOnSevereHypo) {
    return { type: "severe_hypo", severity: "critical" }
  }
  if (glucoseMgdl < thresholds.lowMgdl && rules.alertOnHypo) {
    return { type: "hypo", severity: "warning" }
  }
  if (glucoseMgdl >= thresholds.highMgdl && rules.alertOnSevereHyper) {
    return { type: "severe_hyper", severity: "critical" }
  }
  if (glucoseMgdl > thresholds.okMgdl && rules.alertOnHyper) {
    return { type: "hyper", severity: "warning" }
  }
  return null
}

function classifyKetoneAlert(
  ketoneMmol: number,
  thresholds: {
    moderateThreshold: number
    dkaThreshold: number
    alertOnModerate: boolean
    alertOnDka: boolean
  },
): { type: EmergencyAlertType; severity: EmergencyAlertSeverity } | null {
  // Clinical safety: a ≥DKA reading is *always* an emergency. We never
  // downgrade it to "moderate" just because alertOnDka is off — that would
  // hide a true DKA episode. If alertOnDka is off, suppress the alert
  // entirely; clinician opted out of DKA notifications (e.g. inpatient).
  if (ketoneMmol >= thresholds.dkaThreshold) {
    return thresholds.alertOnDka
      ? { type: "ketone_dka", severity: "critical" }
      : null
  }
  if (ketoneMmol >= thresholds.moderateThreshold && thresholds.alertOnModerate) {
    return { type: "ketone_moderate", severity: "warning" }
  }
  return null
}

/**
 * Capture a snapshot of recent CGM points for timeline display (US-2225).
 * Returns an encrypted base64 string for at-rest protection of PHI.
 */
async function captureContextSnapshot(
  patientId: number,
  triggeredAt: Date,
): Promise<string> {
  const since = new Date(
    triggeredAt.getTime() - CONTEXT_WINDOW_MINUTES * 60_000,
  )
  const points = await prisma.cgmEntry.findMany({
    where: { patientId, timestamp: { gte: since, lte: triggeredAt } },
    orderBy: { timestamp: "asc" },
    take: CONTEXT_MAX_POINTS,
    select: { timestamp: true, valueGl: true },
  })
  const payload: CgmSnapshotPoint[] = points.map((p) => ({
    ts: p.timestamp.toISOString(),
    mgdl: p.valueGl.toNumber() * GL_TO_MGDL,
  }))
  return encryptField(JSON.stringify(payload))
}

function decryptSnapshot(encrypted: string | null): CgmSnapshotPoint[] {
  if (!encrypted) return []
  const plaintext = safeDecryptField(encrypted)
  if (!plaintext) {
    // Decryption failure → likely key rotation gone wrong or DB tamper.
    // Alert ops without leaking ciphertext (HDS / ANSSI RGS).
    logger.error("emergency", "context_snapshot_decryption_failed")
    return []
  }
  try {
    const parsed = JSON.parse(plaintext) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p): p is CgmSnapshotPoint =>
        typeof p === "object" &&
        p !== null &&
        "ts" in p &&
        "mgdl" in p &&
        typeof (p as { ts: unknown }).ts === "string" &&
        typeof (p as { mgdl: unknown }).mgdl === "number",
    )
  } catch {
    return []
  }
}

/**
 * Effective cooldown — capped at 15 min for critical severity to avoid
 * silencing deteriorating Level 2 hypo / DKA episodes.
 */
function effectiveCooldown(
  configuredMinutes: number,
  severity: EmergencyAlertSeverity,
): number {
  if (severity === "critical") {
    return Math.min(configuredMinutes, CRITICAL_COOLDOWN_CEILING)
  }
  return configuredMinutes
}

/**
 * Check whether an existing live alert blocks re-emission.
 * Severity-aware: a higher-severity classification can pierce cooldown of
 * the same alertType (e.g. hypo escalating to severe_hypo).
 */
async function findCooldownBlocker(
  patientId: number,
  alertType: EmergencyAlertType,
  cooldownMinutes: number,
  now: Date,
): Promise<{ id: number } | null> {
  const cooldownStart = new Date(now.getTime() - cooldownMinutes * 60_000)
  const found = await prisma.emergencyAlert.findFirst({
    where: {
      patientId,
      alertType,
      OR: [
        { status: { in: ["open", "acknowledged"] } },
        { status: "resolved", resolvedAt: { gte: cooldownStart } },
      ],
    },
    select: { id: true },
    orderBy: { triggeredAt: "desc" },
  })
  return found
}

/**
 * Notify the patient's doctor referent of a critical alert (US-2230 / US-2266).
 *
 * **Lockscreen privacy** (push): title/body are intentionally generic; the
 * alert type & severity are placed in `data` only (not displayed without unlock).
 *
 * **PHI safety** (email): the email body is generic — see
 * `emailService.sendDoctorEmergencyAlert`. No alert type, severity, glucose
 * or ketone value, no patient name. Only an opaque `Patient #N` label and
 * an authenticated deep link.
 *
 * Best-effort: push and email run in parallel; failures are logged but never
 * break the trigger transaction. If either channel is requested but no
 * referent is configured, we no-op silently.
 */
async function notifyCriticalAlert(
  alert: {
    id: number
    patientId: number
    alertType: EmergencyAlertType
    severity: EmergencyAlertSeverity
  },
  notifyPush: boolean,
  notifyEmail: boolean,
  senderId: number,
): Promise<void> {
  if (!notifyPush && !notifyEmail) return

  try {
    const referent = await prisma.patientReferent.findUnique({
      where: { patientId: alert.patientId },
      select: { pro: { select: { userId: true } } },
    })
    const referentUserId = referent?.pro?.userId
    if (!referentUserId) return

    const tasks: Array<Promise<unknown>> = []

    if (notifyPush) {
      // Generic lockscreen title/body — alert type only in data payload.
      tasks.push(
        withTimeout(
          fcmService.sendToUser({
            userId: referentUserId,
            senderId,
            title: "Diabeo — Alerte",
            body: "Connectez-vous pour voir les détails.",
            data: {
              kind: "emergency_alert",
              alertId: String(alert.id),
              patientId: String(alert.patientId),
              alertType: alert.alertType,
              severity: alert.severity,
              deepLink: `/dashboard/emergencies/${alert.id}`,
            },
          }),
          DISPATCH_TIMEOUT_MS,
          "fcm_dispatch",
        ).catch((err) => {
          logger.error("emergency", "FCM dispatch failed for critical alert", {
            patientId: alert.patientId,
          }, err)
        }),
      )
    }

    if (notifyEmail) {
      tasks.push(
        withTimeout(
          dispatchDoctorEmail({ referentUserId, alert, senderId }),
          DISPATCH_TIMEOUT_MS,
          "email_dispatch",
        ).catch((err) => {
          logger.error("emergency", "Email dispatch timeout/failure", {
            patientId: alert.patientId,
          }, err)
        }),
      )
    }

    // allSettled — one channel's hard failure must never short-circuit the
    // other (push & email are independent best-effort dispatches).
    await Promise.allSettled(tasks)
  } catch (err) {
    logger.error("emergency", "Critical-alert dispatch failed", {
      patientId: alert.patientId,
    }, err)
  }
}

/**
 * Email path of US-2266 — fetches the doctor's encrypted email, decrypts in
 * memory only (never logged), sends generic email via Resend, audits as
 * EMAIL_SENT. Failures are isolated so they cannot break push or alert.
 *
 * Catches narrowly: only Resend / decryption / audit-log issues are
 * absorbed. A `Prisma.PrismaClientInitializationError` (DB unreachable)
 * is rethrown so the surrounding `notifyCriticalAlert` outer try can
 * surface a clear ops signal.
 */
async function dispatchDoctorEmail(input: {
  referentUserId: number
  alert: { id: number; patientId: number }
  senderId: number
}): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: input.referentUserId },
      select: { email: true },
    })
    const decryptedEmail = user?.email ? safeDecryptField(user.email) : null
    if (!decryptedEmail) {
      logger.warn("emergency", "Doctor email unavailable — skipping email dispatch", {
        userId: input.referentUserId,
      })
      // Record a CONFIG_ERROR in the audit log so a key-rotation drift or a
      // missing referent.email cannot silently disable critical-alert delivery
      // without a forensic trace (HDS §IV.3 + ANSSI RGS).
      await auditService.log({
        userId: input.senderId,
        action: "CONFIG_ERROR",
        resource: "USER",
        resourceId: String(input.referentUserId),
        metadata: {
          reason: "email_decryption_failed_or_missing",
          alertId: input.alert.id,
        },
      }).catch((err) => {
        logger.error("emergency", "Failed to audit CONFIG_ERROR", {
          userId: input.referentUserId,
        }, err)
      })
      return
    }

    const result = await emailService.sendDoctorEmergencyAlert({
      doctorEmail: decryptedEmail,
      alertId: input.alert.id,
      patientInternalId: input.alert.patientId,
    })

    if (result.sent) {
      // Audit log records the *fact* of provider acceptance — no PHI, no
      // email content. Action is `EMAIL_SUBMITTED` (not "SENT") because Resend
      // confirms submission to MTA, not delivery to the doctor's mailbox —
      // HDS forensic accuracy. Delivery webhooks (V1+) emit a follow-up row.
      await auditService.log({
        userId: input.senderId,
        action: "EMAIL_SUBMITTED",
        resource: "EMERGENCY_ALERT",
        resourceId: String(input.alert.id),
        metadata: {
          recipientUserId: input.referentUserId,
          channel: "email",
          ...(result.id && { providerMessageId: result.id }),
        },
      })
    } else {
      logger.warn("emergency", "Email send returned non-sent result", {
        userId: input.referentUserId,
      })
    }
  } catch (err) {
    // Surface infrastructure-level Prisma errors (DB down, init failure) —
    // those need ops attention, not silent log entries.
    if (
      err instanceof Prisma.PrismaClientInitializationError ||
      err instanceof Prisma.PrismaClientRustPanicError
    ) {
      throw err
    }
    logger.error("emergency", "Email dispatch failed for critical alert", {
      patientId: input.alert.patientId,
    }, err)
  }
}

/**
 * Insert helper that traps *only* the live-alert partial-unique-index
 * collision (TOCTOU race). Any other constraint violation is rethrown to
 * surface the real bug, never masked behind a "cooldown blocked" no-op.
 */
async function safeCreateAlert<T>(
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const target = err.meta?.target
      const targetStr = Array.isArray(target) ? target.join(",") : String(target ?? "")
      if (targetStr.includes(LIVE_ALERT_UNIQUE_INDEX)) {
        return null
      }
    }
    throw err
  }
}

/**
 * Decrypt user-facing fields on an alert read AND strip the encrypted
 * `contextSnapshot` ciphertext from the API-bound payload (per project rule
 * "JAMAIS exposer le Buffer/base64 chiffré dans les API responses" — CLAUDE.md).
 * Returns a derived `contextSnapshotPoints: CgmSnapshotPoint[]` instead.
 */
function decryptAlertFields<
  T extends {
    notes?: string | null
    resolutionNotes?: string | null
    contextSnapshot?: string | null
  },
>(alert: T): Omit<T, "contextSnapshot"> & {
  notes: string | null
  resolutionNotes: string | null
  contextSnapshotPoints: CgmSnapshotPoint[]
} {
  const { contextSnapshot, ...rest } = alert
  return {
    ...rest,
    notes: safeDecryptField(alert.notes ?? null),
    resolutionNotes: safeDecryptField(alert.resolutionNotes ?? null),
    contextSnapshotPoints: decryptSnapshot(contextSnapshot ?? null),
  }
}

export const emergencyService = {
  /**
   * Detect & emit alert from a freshly-recorded CGM value.
   * No-op if no threshold breached or cooldown still active.
   */
  async detectFromCgm(
    input: DetectFromCgmInput,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<{ id: number; alertType: EmergencyAlertType } | null> {
    // Reject sensor-error values upstream — never persist out-of-range readings.
    if (
      input.glucoseValueMgdl < GLUCOSE_BOUNDS.MIN ||
      input.glucoseValueMgdl > GLUCOSE_BOUNDS.MAX ||
      !Number.isFinite(input.glucoseValueMgdl)
    ) {
      return null
    }
    const triggeredAt = input.triggeredAt ?? new Date()
    const [cgmObjective, alertConfig, patient] = await Promise.all([
      prisma.cgmObjective.findUnique({ where: { patientId: input.patientId } }),
      prisma.alertThresholdConfig.findUnique({
        where: { patientId: input.patientId },
      }),
      prisma.patient.findFirst({
        where: { id: input.patientId, deletedAt: null },
        select: { id: true, pregnancyMode: true, pathology: true },
      }),
    ])
    if (!patient) return null

    const isStrict = patient.pregnancyMode || patient.pathology === "GD"
    // Fallback uses the same getCgmDefaults() as the rest of the system —
    // single source of truth (objectives.service.ts: ADA / Battelino 2019).
    const thresholds = (() => {
      if (cgmObjective) {
        return {
          veryLowMgdl: cgmObjective.veryLow.toNumber() * GL_TO_MGDL,
          lowMgdl: cgmObjective.low.toNumber() * GL_TO_MGDL,
          okMgdl: cgmObjective.ok.toNumber() * GL_TO_MGDL,
          highMgdl: cgmObjective.high.toNumber() * GL_TO_MGDL,
        }
      }
      const d = getCgmDefaults(isStrict ? "GD" : patient.pathology)
      return {
        veryLowMgdl: d.veryLow * GL_TO_MGDL,
        lowMgdl: d.low * GL_TO_MGDL,
        okMgdl: d.ok * GL_TO_MGDL,
        highMgdl: d.high * GL_TO_MGDL,
      }
    })()

    const rules = alertConfig ?? ALERT_THRESHOLD_DEFAULTS

    const classified = classifyCgmAlert(input.glucoseValueMgdl, thresholds, rules)
    if (!classified) return null

    const cooldown = effectiveCooldown(rules.cooldownMinutes, classified.severity)
    const blocker = await findCooldownBlocker(
      input.patientId,
      classified.type,
      cooldown,
      triggeredAt,
    )
    if (blocker) return null

    const contextSnapshot = await captureContextSnapshot(input.patientId, triggeredAt)

    const alert = await safeCreateAlert(() =>
      prisma.$transaction(async (tx) => {
        const created = await tx.emergencyAlert.create({
          data: {
            patientId: input.patientId,
            alertType: classified.type,
            severity: classified.severity,
            status: "open",
            triggeredAt,
            glucoseValueMgdl: input.glucoseValueMgdl,
            contextSnapshot,
          },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "CREATE",
          resource: "PATIENT",
          resourceId: `${input.patientId}:emergency-alert:${created.id}`,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          metadata: {
            alertType: classified.type,
            severity: classified.severity,
            glucoseValueMgdl: input.glucoseValueMgdl,
          },
        })
        return created
      }),
    )

    if (!alert) return null

    const isCritical = classified.severity === "critical"
    await notifyCriticalAlert(
      {
        id: alert.id,
        patientId: alert.patientId,
        alertType: alert.alertType,
        severity: alert.severity,
      },
      rules.notifyDoctorPush && isCritical,
      rules.notifyDoctorEmail && isCritical,
      auditUserId,
    )

    return { id: alert.id, alertType: alert.alertType }
  },

  /**
   * Detect & emit alert from a ketone reading.
   */
  async detectFromKetone(
    input: DetectFromKetoneInput,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<{ id: number; alertType: EmergencyAlertType } | null> {
    if (
      input.ketoneValueMmol < KETONE_BOUNDS.MIN ||
      input.ketoneValueMmol > KETONE_BOUNDS.MAX ||
      !Number.isFinite(input.ketoneValueMmol)
    ) {
      return null
    }
    const triggeredAt = input.triggeredAt ?? new Date()
    const [config, alertConfig, patient] = await Promise.all([
      prisma.ketoneThreshold.findUnique({ where: { patientId: input.patientId } }),
      prisma.alertThresholdConfig.findUnique({
        where: { patientId: input.patientId },
      }),
      prisma.patient.findFirst({
        where: { id: input.patientId, deletedAt: null },
        select: { id: true },
      }),
    ])
    if (!patient) return null

    const thresholds = config
      ? {
          moderateThreshold: config.moderateThreshold.toNumber(),
          dkaThreshold: config.dkaThreshold.toNumber(),
          alertOnModerate: config.alertOnModerate,
          alertOnDka: config.alertOnDka,
        }
      : { moderateThreshold: 1.5, dkaThreshold: 3.0, alertOnModerate: true, alertOnDka: true }

    const classified = classifyKetoneAlert(input.ketoneValueMmol, thresholds)
    if (!classified) return null

    const baseCooldown = alertConfig?.cooldownMinutes ?? 30
    const cooldown = effectiveCooldown(baseCooldown, classified.severity)
    const blocker = await findCooldownBlocker(
      input.patientId,
      classified.type,
      cooldown,
      triggeredAt,
    )
    if (blocker) return null

    const alert = await safeCreateAlert(() =>
      prisma.$transaction(async (tx) => {
        const created = await tx.emergencyAlert.create({
          data: {
            patientId: input.patientId,
            alertType: classified.type,
            severity: classified.severity,
            status: "open",
            triggeredAt,
            ketoneValueMmol: input.ketoneValueMmol,
          },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "CREATE",
          resource: "PATIENT",
          resourceId: `${input.patientId}:emergency-alert:${created.id}`,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          metadata: {
            alertType: classified.type,
            severity: classified.severity,
            ketoneValueMmol: input.ketoneValueMmol,
          },
        })
        return created
      }),
    )

    if (!alert) return null

    const isCritical = classified.severity === "critical"
    const notifyPush = (alertConfig?.notifyDoctorPush ?? ALERT_THRESHOLD_DEFAULTS.notifyDoctorPush) && isCritical
    const notifyEmail = (alertConfig?.notifyDoctorEmail ?? ALERT_THRESHOLD_DEFAULTS.notifyDoctorEmail) && isCritical
    await notifyCriticalAlert(
      {
        id: alert.id,
        patientId: alert.patientId,
        alertType: alert.alertType,
        severity: alert.severity,
      },
      notifyPush,
      notifyEmail,
      auditUserId,
    )

    return { id: alert.id, alertType: alert.alertType }
  },

  /**
   * Manually create an alert (e.g. patient self-report).
   * Cooldown applies to manual alerts to prevent inbox flooding.
   */
  async createManual(
    input: CreateManualAlertInput,
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    // Critical-severity manual alerts bypass threshold detection — gate them
    // on DOCTOR+ role and require justification text to prevent inbox flood
    // from a NURSE marking everything as "critical".
    if (input.severity === "critical") {
      if (input.callerRole !== "ADMIN" && input.callerRole !== "DOCTOR") {
        throw new Error("critical_manual_requires_doctor")
      }
      if (!input.notes?.trim()) {
        throw new Error("critical_manual_requires_notes")
      }
    }

    const patient = await prisma.patient.findFirst({
      where: { id: input.patientId, deletedAt: null },
      select: { id: true },
    })
    if (!patient) throw new Error("patient_not_found")

    const triggeredAt = new Date()
    const alertConfig = await prisma.alertThresholdConfig.findUnique({
      where: { patientId: input.patientId },
      select: { cooldownMinutes: true, notifyDoctorPush: true, notifyDoctorEmail: true },
    })
    const cooldown = effectiveCooldown(
      alertConfig?.cooldownMinutes ?? ALERT_THRESHOLD_DEFAULTS.cooldownMinutes,
      input.severity,
    )
    const blocker = await findCooldownBlocker(
      input.patientId,
      "manual",
      cooldown,
      triggeredAt,
    )
    if (blocker) throw new Error("manual_alert_cooldown")

    const contextSnapshot = await captureContextSnapshot(input.patientId, triggeredAt)
    const encryptedNotes = input.notes?.trim()
      ? encryptField(input.notes.trim())
      : null

    const alert = await safeCreateAlert(() =>
      prisma.$transaction(async (tx) => {
        const created = await tx.emergencyAlert.create({
          data: {
            patientId: input.patientId,
            alertType: "manual",
            severity: input.severity,
            status: "open",
            triggeredAt,
            notes: encryptedNotes,
            contextSnapshot,
          },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "CREATE",
          resource: "PATIENT",
          resourceId: `${input.patientId}:emergency-alert:${created.id}`,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          metadata: { alertType: "manual", severity: input.severity },
        })
        return created
      }),
    )

    if (!alert) throw new Error("manual_alert_cooldown")

    const isCritical = input.severity === "critical"
    await notifyCriticalAlert(
      {
        id: alert.id,
        patientId: alert.patientId,
        alertType: alert.alertType,
        severity: alert.severity,
      },
      (alertConfig?.notifyDoctorPush ?? ALERT_THRESHOLD_DEFAULTS.notifyDoctorPush) && isCritical,
      (alertConfig?.notifyDoctorEmail ?? ALERT_THRESHOLD_DEFAULTS.notifyDoctorEmail) && isCritical,
      auditUserId,
    )

    return decryptAlertFields(alert)
  },

  /**
   * RBAC-scoped inbox listing.
   * Pros (NURSE/DOCTOR/VIEWER) MUST pass `scopePatientIds` (their accessible
   * patients). ADMIN passes null/undefined for unrestricted access.
   */
  async list(filter: EmergencyAlertListFilter, auditUserId: number, ctx?: AuditContext) {
    const limit = Math.min(filter.limit ?? 25, MAX_LIST_LIMIT)

    // RBAC scope guard — caller MUST pass scope for non-ADMIN.
    const scopeFilter: Prisma.EmergencyAlertWhereInput = (() => {
      if (filter.patientId !== undefined) {
        return { patientId: filter.patientId }
      }
      if (filter.scopePatientIds === undefined || filter.scopePatientIds === null) {
        // ADMIN unrestricted
        return {}
      }
      if (filter.scopePatientIds.length === 0) {
        // Pro with no patients in portfolio — empty scope.
        return { patientId: { in: [] } }
      }
      return { patientId: { in: filter.scopePatientIds } }
    })()

    const where: Prisma.EmergencyAlertWhereInput = {
      patient: { deletedAt: null },
      ...scopeFilter,
      ...(filter.status?.length && { status: { in: filter.status } }),
      ...(filter.severity?.length && { severity: { in: filter.severity } }),
      ...(filter.alertType?.length && { alertType: { in: filter.alertType } }),
      ...((filter.from ?? filter.to) && {
        triggeredAt: {
          ...(filter.from && { gte: filter.from }),
          ...(filter.to && { lte: filter.to }),
        },
      }),
    }

    const items = await prisma.emergencyAlert.findMany({
      where,
      orderBy: [
        { severity: "desc" },
        { triggeredAt: "desc" },
      ],
      take: limit + 1,
      ...(filter.cursor && { cursor: { id: filter.cursor }, skip: 1 }),
    })

    const hasMore = items.length > limit
    const page = hasMore ? items.slice(0, limit) : items
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      resourceId: "emergency-alerts:list",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: {
        count: page.length,
        scoped: filter.scopePatientIds !== undefined && filter.scopePatientIds !== null,
      },
    })

    return {
      items: page.map((a) => decryptAlertFields(a)),
      nextCursor,
    }
  },

  /**
   * Lightweight loader used for authorization checks — does NOT audit.
   * Returns minimal fields needed by canAccessPatient.
   */
  async loadForAccessCheck(alertId: number) {
    return prisma.emergencyAlert.findUnique({
      where: { id: alertId },
      select: { id: true, patientId: true, patient: { select: { deletedAt: true } } },
    })
  },

  /**
   * Detail view incl. timeline (CGM context window) — US-2225.
   * Caller must have already authorized the alert via loadForAccessCheck.
   * Single query: filters out soft-deleted patients via the relation.
   */
  async getDetail(alertId: number, auditUserId: number, ctx?: AuditContext) {
    const alert = await prisma.emergencyAlert.findFirst({
      where: { id: alertId, patient: { deletedAt: null } },
      include: { actions: { orderBy: { createdAt: "asc" } } },
    })
    if (!alert) return null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      resourceId: `${alert.patientId}:emergency-alert:${alertId}`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    return {
      ...decryptAlertFields(alert),
      actions: alert.actions.map((a) => ({
        ...a,
        notes: safeDecryptField(a.notes),
      })),
    }
  },

  async acknowledge(
    alertId: number,
    userId: number,
    notes: string | undefined,
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.emergencyAlert.findUnique({
        where: { id: alertId },
        select: {
          id: true,
          status: true,
          patientId: true,
          patient: { select: { deletedAt: true } },
        },
      })
      if (!existing) throw new Error("alert_not_found")
      if (existing.patient.deletedAt) throw new Error("patient_deleted")
      if (existing.status !== "open") throw new Error("alert_not_open")

      // Race-safe update: a concurrent acknowledge by another doctor will
      // throw P2025 (record not found), which we map to alert_not_open.
      let updated
      try {
        updated = await tx.emergencyAlert.update({
          where: { id: alertId, status: "open" },
          data: {
            status: "acknowledged",
            acknowledgedBy: userId,
            acknowledgedAt: new Date(),
          },
        })
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
          throw new Error("alert_not_open")
        }
        throw e
      }

      const encryptedNotes = notes?.trim() ? encryptField(notes.trim()) : null
      await tx.emergencyAlertAction.create({
        data: {
          alertId,
          performedBy: userId,
          actionType: "acknowledge",
          notes: encryptedNotes,
        },
      })

      await auditService.logWithTx(tx, {
        userId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${existing.patientId}:emergency-alert:${alertId}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { transition: "open->acknowledged" },
      })

      return decryptAlertFields(updated)
    })
  },

  async resolve(
    alertId: number,
    userId: number,
    resolutionNotes: string | undefined,
    ctx?: AuditContext,
  ) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.emergencyAlert.findUnique({
        where: { id: alertId },
        select: {
          id: true,
          status: true,
          patientId: true,
          patient: { select: { deletedAt: true } },
        },
      })
      if (!existing) throw new Error("alert_not_found")
      if (existing.patient.deletedAt) throw new Error("patient_deleted")
      if (existing.status === "resolved" || existing.status === "expired") {
        throw new Error("alert_already_closed")
      }

      const encryptedNotes = resolutionNotes?.trim()
        ? encryptField(resolutionNotes.trim())
        : null

      // Race-safe update: only transition from {open, acknowledged}.
      let updated
      try {
        updated = await tx.emergencyAlert.update({
          where: { id: alertId, status: { in: ["open", "acknowledged"] } },
          data: {
            status: "resolved",
            resolvedBy: userId,
            resolvedAt: new Date(),
            resolutionNotes: encryptedNotes,
          },
        })
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
          throw new Error("alert_already_closed")
        }
        throw e
      }

      await tx.emergencyAlertAction.create({
        data: {
          alertId,
          performedBy: userId,
          actionType: "resolve",
          notes: encryptedNotes,
        },
      })

      await auditService.logWithTx(tx, {
        userId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${existing.patientId}:emergency-alert:${alertId}`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { transition: `${existing.status}->resolved` },
      })

      return decryptAlertFields(updated)
    })
  },

  /**
   * Append a workflow action without changing the alert status.
   * Used for "call patient" / "adjust treatment" / "send message" steps.
   */
  async addAction(input: AlertActionInput, ctx?: AuditContext) {
    const alert = await prisma.emergencyAlert.findUnique({
      where: { id: input.alertId },
      select: {
        id: true,
        patientId: true,
        status: true,
        patient: { select: { deletedAt: true } },
      },
    })
    if (!alert) throw new Error("alert_not_found")
    if (alert.patient.deletedAt) throw new Error("patient_deleted")
    if (alert.status === "expired") throw new Error("alert_expired")

    const encryptedNotes = input.notes?.trim()
      ? encryptField(input.notes.trim())
      : null
    const safeMetadata = {
      ...(input.metadata?.durationSec !== undefined && { durationSec: input.metadata.durationSec }),
      ...(input.metadata?.outcome !== undefined && { outcome: input.metadata.outcome }),
    }

    return prisma.$transaction(async (tx) => {
      const action = await tx.emergencyAlertAction.create({
        data: {
          alertId: input.alertId,
          performedBy: input.performedBy,
          actionType: input.actionType,
          notes: encryptedNotes,
          metadata: safeMetadata,
        },
      })

      await auditService.logWithTx(tx, {
        userId: input.performedBy,
        action: "CREATE",
        resource: "PATIENT",
        resourceId: `${alert.patientId}:emergency-alert:${input.alertId}:action`,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: { actionType: input.actionType },
      })

      return {
        ...action,
        notes: safeDecryptField(action.notes),
      }
    })
  },
}

export const __test__ = {
  classifyCgmAlert,
  classifyKetoneAlert,
  effectiveCooldown,
  CRITICAL_COOLDOWN_CEILING,
}
