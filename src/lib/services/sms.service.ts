/**
 * @module services/sms
 * @description US-2506 V1 — Service SMS **mock provider**.
 *
 * ### Scope V1
 *
 * Cette implémentation est un **mock délibéré** : `sendSms` ne contacte
 * AUCUN provider externe. Elle :
 *   1. Verifie `cabinet.smsEnabled` (admin toggle US-2506).
 *   2. Verifie `cabinet.smsCreditBalance >= creditCost`.
 *   3. Decremente atomiquement les credits.
 *   4. Persiste un `SmsLog` avec `provider="mock"` + `status="mock"`.
 *   5. Retourne `{sent: true, providerMessageId: "mock-<uuid>"}`.
 *
 * **Aucun SMS n'est réellement envoyé en V1.** Le caller (typiquement
 * `appointment-reminder.service.ts` US-2502) traite le retour comme
 * un succès.
 *
 * ### Scope V3 (US-2506bis)
 *
 * L'intégration real Twilio / OVH SMS est différée V3 sous nouvelle US
 * `US-2506bis`. Migration prévue :
 *   - Remplacer le mock par un client SDK (Twilio ou OVH).
 *   - Conserver le contrat de signature `sendSms` (zero breaking change).
 *   - Migrer `provider="mock"` → `provider="twilio"` / `"ovh"`.
 *   - `status="mock"` → `"sent"` / `"failed"` real.
 *   - Procurement requis : contrat Twilio/OVH + DPA + budget crédits.
 *
 * ### Sécurité HDS / RGPD
 *
 *   - Numero destinataire chiffre AES-256-GCM dans `SmsLog.toEnc`.
 *   - Message excerpt cap 120 chars (anti leak PHI plaintext).
 *   - Audit `SMS_LOG` resource + metadata.patientId pivot (US-2268).
 *   - Decrement credit atomique via `updateMany WHERE smsCreditBalance >= N`.
 */

import { Prisma } from "@prisma/client"
import type { SmsStatus } from "@prisma/client"
import { randomUUID } from "crypto"
import { prisma } from "@/lib/db/client"
import { encryptField } from "@/lib/crypto/fields"
import { auditService, type AuditContext } from "./audit.service"
import { logger } from "@/lib/logger"

// ─────────────────────────────────────────────────────────────
// Erreurs typees
// ─────────────────────────────────────────────────────────────

export class SmsDisabledError extends Error {
  constructor(public cabinetId: number) {
    super(`SMS not enabled for cabinet ${cabinetId}`)
    this.name = "SmsDisabledError"
  }
}

export class SmsInsufficientCreditError extends Error {
  constructor(public cabinetId: number, public balance: number, public required: number) {
    super(`Insufficient SMS credits (balance=${balance}, required=${required})`)
    this.name = "SmsInsufficientCreditError"
  }
}

export class SmsValidationError extends Error {
  constructor(public field: string, public reason: string) {
    super(`sms:${field}:${reason}`)
    this.name = "SmsValidationError"
  }
}

// ─────────────────────────────────────────────────────────────
// Audit kinds
// ─────────────────────────────────────────────────────────────

export type SmsAuditKind =
  | "sms.sent"
  | "sms.failed"
  | "sms.skipped"
  | "sms.config.toggled"
  | "sms.config.credits_adjusted"

const AUDIT_KIND = {
  SENT: "sms.sent",
  FAILED: "sms.failed",
  SKIPPED: "sms.skipped",
  CONFIG_TOGGLED: "sms.config.toggled",
  CREDITS_ADJUSTED: "sms.config.credits_adjusted",
} as const satisfies Record<string, SmsAuditKind>

export { AUDIT_KIND as SMS_AUDIT_KIND }

// ─────────────────────────────────────────────────────────────
// Result types
// ─────────────────────────────────────────────────────────────

export interface SmsSendResult {
  sent: boolean
  status: SmsStatus
  providerMessageId: string | null
  error?: string
}

export interface SmsConfig {
  smsEnabled: boolean
  smsCreditBalance: number
}

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

/** Validation simple e164-ish. Real provider V3 fera validation stricte. */
const PHONE_E164_RE = /^\+\d{8,15}$/

export function isValidPhone(raw: string): boolean {
  if (typeof raw !== "string") return false
  // Normalise espaces avant test.
  const normalized = raw.replace(/\s+/g, "")
  return PHONE_E164_RE.test(normalized)
}

export function normalizePhone(raw: string): string {
  return raw.replace(/\s+/g, "").trim()
}

// ─────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────

export const smsService = {
  /**
   * Envoi SMS — V1 mock provider.
   *
   * Workflow :
   *   1. Valide format phone (e164-like).
   *   2. Verifie cabinet.smsEnabled + creditBalance >= creditCost.
   *   3. Decremente credits atomiquement (updateMany WHERE balance >= N).
   *   4. Persiste SmsLog status='mock' + provider='mock'.
   *   5. Audit `sms.sent` + metadata.patientId pivot.
   *
   * @throws SmsDisabledError si cabinet.smsEnabled=FALSE.
   * @throws SmsInsufficientCreditError si balance < creditCost.
   * @throws SmsValidationError si phone invalide.
   */
  async sendSms(
    input: {
      cabinetId: number
      to: string
      message: string
      contextKind: string
      creditCost?: number
    },
    auditUserId: number | null,
    ctx: AuditContext,
    metadata: { patientId?: number; appointmentId?: number } = {},
  ): Promise<SmsSendResult> {
    const creditCost = input.creditCost ?? 1
    const phone = normalizePhone(input.to)
    if (!isValidPhone(phone)) {
      throw new SmsValidationError("to", "invalidPhone")
    }

    // H2 round 2 — atomic check + decrement HORS $transaction wrappante
    // (le throw skipped invalidait le persist sinon).
    const result = await prisma.healthcareService.updateMany({
      where: {
        id: input.cabinetId,
        smsEnabled: true,
        smsCreditBalance: { gte: creditCost },
      },
      data: { smsCreditBalance: { decrement: creditCost } },
    })

    if (result.count === 0) {
      // Discriminer pour throw error précis (forensique audit).
      const cabinet = await prisma.healthcareService.findUnique({
        where: { id: input.cabinetId },
        select: { smsEnabled: true, smsCreditBalance: true },
      })
      if (!cabinet) {
        throw new SmsValidationError("cabinetId", "notFound")
      }
      const reason = !cabinet.smsEnabled ? "sms_disabled" : "insufficient_credits"
      // H2 round 2 — persist skipped log AVANT throw, dans tx isolée (commit
      // garanti même si caller catch le throw).
      await this.persistSmsLogStandalone(
        input.cabinetId, "skipped", phone, input.message,
        null, reason, input.contextKind, creditCost,
        auditUserId, ctx, metadata,
      )
      if (!cabinet.smsEnabled) {
        throw new SmsDisabledError(input.cabinetId)
      }
      throw new SmsInsufficientCreditError(
        input.cabinetId, cabinet.smsCreditBalance, creditCost,
      )
    }

    // V1 mock — pas de vrai envoi. Generate provider message ID.
    const providerMessageId = `mock-${randomUUID()}`
    await this.persistSmsLogStandalone(
      input.cabinetId, "mock", phone, input.message,
      providerMessageId, null, input.contextKind, creditCost,
      auditUserId, ctx, metadata,
    )

    // Alerte ops si credits balance bas (<10).
    // M4 round 2 — ajout `cabinetId` pour alerte opérationnelle utile.
    const updatedBalance = await prisma.healthcareService.findUnique({
      where: { id: input.cabinetId },
      select: { smsCreditBalance: true },
    })
    if (updatedBalance && updatedBalance.smsCreditBalance < 10) {
      logger.warn(
        "sms",
        "cabinet credits low",
        {
          resource: "SMS_LOG",
          kind: "credits.low_balance",
          cabinetId: input.cabinetId,
        },
      )
    }

    return {
      sent: true,
      status: "mock" as const,
      providerMessageId,
    }
  },

  /**
   * H2 round 2 — Standalone persist (sa propre tx) pour garantir commit
   * même si caller throw après. Utilisé par les skipped paths.
   *
   * @internal
   */
  async persistSmsLogStandalone(
    cabinetId: number,
    status: SmsStatus,
    phone: string | null,
    message: string,
    providerMessageId: string | null,
    errorMessage: string | null,
    contextKind: string,
    creditCost: number,
    auditUserId: number | null,
    ctx: AuditContext,
    metadata: { patientId?: number; appointmentId?: number } = {},
  ): Promise<void> {
    return prisma.$transaction(async (tx) => {
      await this.persistSmsLog(
        tx, cabinetId, status, phone, message,
        providerMessageId, errorMessage, contextKind, creditCost,
        auditUserId, ctx, metadata,
      )
    })
  },

  /**
   * Persist SmsLog + audit transactionnel.
   * @internal
   */
  async persistSmsLog(
    tx: Prisma.TransactionClient,
    cabinetId: number,
    status: SmsStatus,
    phone: string | null,
    message: string,
    providerMessageId: string | null,
    errorMessage: string | null,
    contextKind: string,
    creditCost: number,
    auditUserId: number | null,
    ctx: AuditContext,
    metadata: { patientId?: number; appointmentId?: number } = {},
  ): Promise<void> {
    const toEnc = phone ? encryptField(phone) : null
    // Excerpt 120 chars pour forensique sans leak plaintext complet.
    const messageExcerpt = message.slice(0, 120)

    const log = await tx.smsLog.create({
      data: {
        cabinetId,
        status,
        toEnc,
        messageExcerpt,
        providerMessageId,
        errorMessage,
        contextKind,
        creditCost,
        provider: "mock", // V1 — toujours mock, V3 elargira.
      },
    })

    const auditKind = status === "mock" || status === "sent"
      ? AUDIT_KIND.SENT
      : status === "failed"
        ? AUDIT_KIND.FAILED
        : AUDIT_KIND.SKIPPED

    await auditService.logWithTx(tx, {
      userId: auditUserId,
      action: "CREATE",
      resource: "SMS_LOG",
      // M3 round 2 (ADR #18) — resourceId = ID natif SmsLog (vs cabinetId
      // qui violait la convention US-2268). cabinetId reste en metadata
      // pivot pour la forensique "tous SMS du cabinet X".
      resourceId: String(log.id),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        kind: auditKind,
        cabinetId,
        contextKind,
        creditCost,
        provider: "mock",
        ...(errorMessage && { errorReason: errorMessage }),
        ...(metadata.patientId && { patientId: metadata.patientId }),
        ...(metadata.appointmentId && { appointmentId: metadata.appointmentId }),
      },
    })
  },

  /**
   * Lit la config SMS d'un cabinet.
   *
   * @throws SmsValidationError si cabinet introuvable.
   */
  async getConfig(cabinetId: number): Promise<SmsConfig> {
    const cabinet = await prisma.healthcareService.findUnique({
      where: { id: cabinetId },
      select: { smsEnabled: true, smsCreditBalance: true },
    })
    if (!cabinet) {
      throw new SmsValidationError("cabinetId", "notFound")
    }
    return cabinet
  },

  /**
   * Toggle SMS feature flag pour un cabinet (ADMIN only).
   * Audit + persist atomique.
   */
  async updateConfig(
    cabinetId: number,
    update: Partial<SmsConfig>,
    auditUserId: number,
    ctx: AuditContext,
  ): Promise<SmsConfig> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.healthcareService.findUnique({
        where: { id: cabinetId },
        select: { smsEnabled: true, smsCreditBalance: true },
      })
      if (!existing) {
        throw new SmsValidationError("cabinetId", "notFound")
      }

      const data: { smsEnabled?: boolean; smsCreditBalance?: number } = {}
      if (typeof update.smsEnabled === "boolean") {
        data.smsEnabled = update.smsEnabled
      }
      if (typeof update.smsCreditBalance === "number") {
        if (update.smsCreditBalance < 0) {
          throw new SmsValidationError("smsCreditBalance", "negative")
        }
        data.smsCreditBalance = update.smsCreditBalance
      }

      const updated = await tx.healthcareService.update({
        where: { id: cabinetId },
        data,
        select: { smsEnabled: true, smsCreditBalance: true },
      })

      // Audit transitions explicites.
      if (data.smsEnabled !== undefined && data.smsEnabled !== existing.smsEnabled) {
        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "UPDATE",
          resource: "CABINET_SMS_CONFIG",
          resourceId: String(cabinetId),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: {
            kind: AUDIT_KIND.CONFIG_TOGGLED,
            before: existing.smsEnabled,
            after: data.smsEnabled,
          },
        })
      }
      if (data.smsCreditBalance !== undefined && data.smsCreditBalance !== existing.smsCreditBalance) {
        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "UPDATE",
          resource: "CABINET_SMS_CONFIG",
          resourceId: String(cabinetId),
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
          metadata: {
            kind: AUDIT_KIND.CREDITS_ADJUSTED,
            before: existing.smsCreditBalance,
            after: data.smsCreditBalance,
            delta: data.smsCreditBalance - existing.smsCreditBalance,
          },
        })
      }

      return updated
    })
  },
}
