/**
 * @description US-2506 V1 mock — sms.service unit tests.
 *
 * Couvre :
 *   - Validation phone e164-like.
 *   - sendSms : cabinet smsEnabled + credits check + decrement atomique.
 *   - SmsDisabledError + SmsInsufficientCreditError + SmsValidationError.
 *   - persistSmsLog : sentToEnc chiffré + messageExcerpt cap 120.
 *   - getConfig + updateConfig admin (toggle + crédits + audit transitions).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import {
  smsService,
  isValidPhone,
  normalizePhone,
  SmsDisabledError,
  SmsInsufficientCreditError,
  SmsValidationError,
  SMS_AUDIT_KIND,
} from "@/lib/services/sms.service"

const ctx = {
  ipAddress: "1.2.3.4",
  userAgent: "test",
  requestId: "req-1",
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.smsLog.create.mockResolvedValue({ id: 1 } as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

// ────────────────────────────────────────────────────────────────
// isValidPhone / normalizePhone
// ────────────────────────────────────────────────────────────────

describe("isValidPhone", () => {
  it("accepte e164 FR", () => {
    expect(isValidPhone("+33612345678")).toBe(true)
  })
  it("accepte DZ", () => {
    expect(isValidPhone("+213612345678")).toBe(true)
  })
  it("normalise espaces puis valide", () => {
    expect(isValidPhone("+33 6 12 34 56 78")).toBe(true)
  })
  it("rejette sans +", () => {
    expect(isValidPhone("0612345678")).toBe(false)
  })
  it("rejette longueur < 8 digits", () => {
    expect(isValidPhone("+331234")).toBe(false)
  })
  it("rejette non-string", () => {
    expect(isValidPhone(undefined as any)).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────
// smsService.sendSms
// ────────────────────────────────────────────────────────────────

describe("smsService.sendSms", () => {
  it("envoie mock SMS si cabinet enabled + credits >= cost", async () => {
    prismaMock.healthcareService.updateMany.mockResolvedValue({ count: 1 } as any)
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 99,
    } as any)
    const result = await smsService.sendSms(
      {
        cabinetId: 1,
        to: "+33612345678",
        message: "Test message",
        contextKind: "appointment_reminder",
      },
      null, ctx,
    )
    expect(result.sent).toBe(true)
    expect(result.status).toBe("mock")
    expect(result.providerMessageId).toMatch(/^mock-[0-9a-f-]{36}$/)
  })

  it("decrement atomique : updateMany WHERE smsEnabled=true AND balance>=cost", async () => {
    prismaMock.healthcareService.updateMany.mockResolvedValue({ count: 1 } as any)
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 99,
    } as any)
    await smsService.sendSms(
      { cabinetId: 1, to: "+33612345678", message: "x", contextKind: "test" },
      null, ctx,
    )
    const where = prismaMock.healthcareService.updateMany.mock.calls[0]![0]!.where as any
    expect(where.id).toBe(1)
    expect(where.smsEnabled).toBe(true)
    expect(where.smsCreditBalance).toEqual({ gte: 1 })
  })

  it("rejette phone invalide", async () => {
    await expect(
      smsService.sendSms(
        { cabinetId: 1, to: "0612345678", message: "x", contextKind: "test" },
        null, ctx,
      ),
    ).rejects.toBeInstanceOf(SmsValidationError)
  })

  it("throws SmsDisabledError si cabinet.smsEnabled=false", async () => {
    prismaMock.healthcareService.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      smsEnabled: false, smsCreditBalance: 100,
    } as any)
    await expect(
      smsService.sendSms(
        { cabinetId: 1, to: "+33612345678", message: "x", contextKind: "test" },
        null, ctx,
      ),
    ).rejects.toBeInstanceOf(SmsDisabledError)
    // SmsLog status=skipped persisté.
    const log = prismaMock.smsLog.create.mock.calls[0]![0]!.data as any
    expect(log.status).toBe("skipped")
    expect(log.errorMessage).toBe("sms_disabled")
  })

  it("throws SmsInsufficientCreditError si credits < cost", async () => {
    prismaMock.healthcareService.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 0,
    } as any)
    await expect(
      smsService.sendSms(
        { cabinetId: 1, to: "+33612345678", message: "x", contextKind: "test" },
        null, ctx,
      ),
    ).rejects.toBeInstanceOf(SmsInsufficientCreditError)
    const log = prismaMock.smsLog.create.mock.calls[0]![0]!.data as any
    expect(log.status).toBe("skipped")
    expect(log.errorMessage).toBe("insufficient_credits")
  })

  it("404 si cabinet introuvable", async () => {
    prismaMock.healthcareService.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.healthcareService.findUnique.mockResolvedValue(null)
    await expect(
      smsService.sendSms(
        { cabinetId: 999, to: "+33612345678", message: "x", contextKind: "test" },
        null, ctx,
      ),
    ).rejects.toBeInstanceOf(SmsValidationError)
  })

  it("sentToEnc chiffré (pas plaintext phone)", async () => {
    prismaMock.healthcareService.updateMany.mockResolvedValue({ count: 1 } as any)
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 99,
    } as any)
    await smsService.sendSms(
      { cabinetId: 1, to: "+33612345678", message: "x", contextKind: "test" },
      null, ctx,
    )
    const log = prismaMock.smsLog.create.mock.calls[0]![0]!.data as any
    expect(log.toEnc).toBeTruthy()
    expect(log.toEnc).not.toContain("+33612345678")
  })

  it("messageExcerpt cap 120 chars (anti leak PHI)", async () => {
    prismaMock.healthcareService.updateMany.mockResolvedValue({ count: 1 } as any)
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 99,
    } as any)
    const longMsg = "x".repeat(500)
    await smsService.sendSms(
      { cabinetId: 1, to: "+33612345678", message: longMsg, contextKind: "test" },
      null, ctx,
    )
    const log = prismaMock.smsLog.create.mock.calls[0]![0]!.data as any
    expect(log.messageExcerpt.length).toBe(120)
  })

  it("audit metadata.patientId pivot US-2268", async () => {
    prismaMock.healthcareService.updateMany.mockResolvedValue({ count: 1 } as any)
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 99,
    } as any)
    await smsService.sendSms(
      { cabinetId: 1, to: "+33612345678", message: "x", contextKind: "test" },
      null, ctx, { patientId: 42, appointmentId: 7 },
    )
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.patientId).toBe(42)
    expect(audit.metadata.appointmentId).toBe(7)
    expect(audit.metadata.kind).toBe(SMS_AUDIT_KIND.SENT)
  })

  it("provider=mock V1 (pas twilio/ovh)", async () => {
    prismaMock.healthcareService.updateMany.mockResolvedValue({ count: 1 } as any)
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 99,
    } as any)
    await smsService.sendSms(
      { cabinetId: 1, to: "+33612345678", message: "x", contextKind: "test" },
      null, ctx,
    )
    const log = prismaMock.smsLog.create.mock.calls[0]![0]!.data as any
    expect(log.provider).toBe("mock")
    expect(log.status).toBe("mock")
  })
})

// ────────────────────────────────────────────────────────────────
// smsService.getConfig / updateConfig
// ────────────────────────────────────────────────────────────────

describe("smsService.getConfig", () => {
  it("retourne {smsEnabled, smsCreditBalance}", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 50,
    } as any)
    const c = await smsService.getConfig(1)
    expect(c).toEqual({ smsEnabled: true, smsCreditBalance: 50 })
  })

  it("throws si cabinet introuvable", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue(null)
    await expect(smsService.getConfig(999)).rejects.toBeInstanceOf(SmsValidationError)
  })
})

describe("smsService.updateConfig", () => {
  it("toggle smsEnabled true → audit transition", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      smsEnabled: false, smsCreditBalance: 0,
    } as any)
    prismaMock.healthcareService.update.mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 0,
    } as any)
    await smsService.updateConfig(1, { smsEnabled: true }, 9, ctx)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.kind).toBe(SMS_AUDIT_KIND.CONFIG_TOGGLED)
    expect(audit.metadata.before).toBe(false)
    expect(audit.metadata.after).toBe(true)
  })

  it("ajuste credits → audit delta", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 10,
    } as any)
    prismaMock.healthcareService.update.mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 100,
    } as any)
    await smsService.updateConfig(1, { smsCreditBalance: 100 }, 9, ctx)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.kind).toBe(SMS_AUDIT_KIND.CREDITS_ADJUSTED)
    expect(audit.metadata.before).toBe(10)
    expect(audit.metadata.after).toBe(100)
    expect(audit.metadata.delta).toBe(90)
  })

  it("rejette credits négatifs", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      smsEnabled: true, smsCreditBalance: 10,
    } as any)
    await expect(
      smsService.updateConfig(1, { smsCreditBalance: -5 }, 9, ctx),
    ).rejects.toBeInstanceOf(SmsValidationError)
  })

  it("404 si cabinet introuvable", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue(null)
    await expect(
      smsService.updateConfig(999, { smsEnabled: true }, 9, ctx),
    ).rejects.toBeInstanceOf(SmsValidationError)
  })
})
