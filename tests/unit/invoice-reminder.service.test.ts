/**
 * @description US-2108 — Relances factures automatiques unit tests.
 *
 * Couvre :
 *   - Selection invoices overdue par step (filtre `reminders: none`).
 *   - Idempotence P2002 UNIQUE(invoiceId, step) → silent skip.
 *   - Email Resend best-effort : echec n'interrompt pas le cron.
 *   - Skipped cases : invoice sans patient OU email decrypt fail.
 *   - Audit metrics + audit per-reminder.
 *   - Email destinataire chiffre AES-256-GCM dans `sentToEnc`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { Prisma } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"

// Mock email service AVANT import du service (pour bien capter l'appel).
vi.mock("@/lib/services/email.service", () => ({
  emailService: {
    sendInvoiceReminder: vi.fn().mockResolvedValue({ sent: true, id: "resend-msg-1" }),
  },
}))

import {
  invoiceReminderService,
  REMINDER_STEPS,
  REMINDER_AUDIT_KIND,
} from "@/lib/services/invoice-reminder.service"
import { emailService } from "@/lib/services/email.service"

const ctx = {
  ipAddress: "1.2.3.4",
  userAgent: "cron",
  requestId: "cron-1",
}

// Helper : fixture invoice avec patient.
function makeInvoice(overrides: Partial<{
  id: number
  number: string | null
  totalCents: number
  currency: string
  issuedAt: Date | null
  patientId: number | null
  emailEnc: string | null
  language: string | null
}> = {}) {
  return {
    id: overrides.id ?? 1,
    number: overrides.number ?? "FR-2026-000042",
    totalCents: overrides.totalCents ?? 12000,
    currency: overrides.currency ?? "EUR",
    issuedAt: overrides.issuedAt ?? new Date("2026-04-01"),
    patientId: overrides.patientId ?? 42,
    patient: overrides.patientId === null ? null : {
      user: {
        id: 100,
        email: overrides.emailEnc ?? "encrypted-email-base64",
        language: overrides.language ?? "fr",
      },
    },
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.invoiceReminder.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

// ────────────────────────────────────────────────────────────────
// processOverdueInvoices — entry cron
// ────────────────────────────────────────────────────────────────

describe("invoiceReminderService.processOverdueInvoices", () => {
  it("retourne metrics empty si aucune invoice overdue", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([])
    const m = await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(m.processed).toBe(0)
    expect(m.sent).toBe(0)
    expect(m.failed).toBe(0)
    expect(m.skipped).toBe(0)
  })

  it("appelle invoice.findMany pour chaque step (3 queries)", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(prismaMock.invoice.findMany).toHaveBeenCalledTimes(REMINDER_STEPS.length)
    // Verifie filtre `reminders: { none: { step } }` present.
    const firstCallWhere = prismaMock.invoice.findMany.mock.calls[0]![0]!.where as any
    expect(firstCallWhere.status).toBe("issued")
    expect(firstCallWhere.reminders.none.step).toBe("step_7")
  })

  it("emit audit cron.run avec metrics", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    const runAudit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === "invoice.reminder.cron.run"
    })
    expect(runAudit).toBeDefined()
    const meta = (runAudit![0].data as any).metadata
    expect(meta.processed).toBe(0)
  })

  it("envoie email pour invoice overdue patient → status=sent", async () => {
    // Mock email decrypt (safeDecryptField appellé sur invoice.patient.user.email)
    const { encryptField } = await import("@/lib/crypto/fields")
    const emailEnc = encryptField("patient@example.com")
    const invFixture = makeInvoice({ emailEnc })
    // 3 calls: step_7 returns [inv], step_15 + step_30 return [].
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([invFixture])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const m = await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(m.sent).toBe(1)
    expect(m.processed).toBe(1)
    expect(emailService.sendInvoiceReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "patient@example.com",
        invoiceNumber: "FR-2026-000042",
        step: "step_7",
        language: "fr",
      }),
    )
  })

  it("skipped si invoice sans patient (cabinet-interne)", async () => {
    const inv = makeInvoice({ patientId: null })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const m = await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(m.skipped).toBe(1)
    expect(m.sent).toBe(0)
    expect(emailService.sendInvoiceReminder).not.toHaveBeenCalled()
    // Persist reminder avec status=skipped + errorReason="no_recipient".
    const skipReminder = prismaMock.invoiceReminder.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.status === "skipped"
    })
    expect(skipReminder).toBeDefined()
  })

  it("skipped si email decrypt fail", async () => {
    const inv = makeInvoice({ emailEnc: "definitely-not-valid-cipher" })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const m = await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(m.skipped).toBe(1)
    expect(emailService.sendInvoiceReminder).not.toHaveBeenCalled()
  })

  it("status=failed si Resend retourne sent:false", async () => {
    vi.mocked(emailService.sendInvoiceReminder).mockResolvedValueOnce({
      sent: false, error: "Resend quota exceeded",
    })
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("patient@example.com") })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const m = await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(m.failed).toBe(1)
    expect(m.sent).toBe(0)
    const failReminder = prismaMock.invoiceReminder.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.status === "failed"
    })
    expect(failReminder).toBeDefined()
    expect((failReminder![0].data as any).errorMessage).toContain("Resend quota")
  })

  it("status=failed si Resend throw (api key manquant)", async () => {
    vi.mocked(emailService.sendInvoiceReminder).mockRejectedValueOnce(
      new Error("RESEND_API_KEY not configured"),
    )
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("patient@example.com") })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const m = await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(m.failed).toBe(1)
  })

  it("idempotent : P2002 UNIQUE(invoiceId, step) → silent skip pas erreur", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("patient@example.com") })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002", clientVersion: "test",
      meta: { target: ["invoice_id", "step"] },
    })
    prismaMock.invoiceReminder.create.mockRejectedValueOnce(p2002)
    // Ne throw pas, mais le metric `sent` est compté car emailService a réussi
    // (le P2002 arrive seulement à la persist). C'est documenté comme race
    // condition acceptable — l'email est parti, le row existe déjà via le 1er run.
    await expect(
      invoiceReminderService.processOverdueInvoices(new Date(), ctx),
    ).resolves.toBeDefined()
  })

  it("byStep metrics ventilent par step", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv7 = makeInvoice({ id: 1, emailEnc: encryptField("a@x.com") })
    const inv15 = makeInvoice({ id: 2, emailEnc: encryptField("b@x.com") })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv7])
      .mockResolvedValueOnce([inv15])
      .mockResolvedValueOnce([])
    const m = await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(m.byStep.step_7.sent).toBe(1)
    expect(m.byStep.step_15.sent).toBe(1)
    expect(m.byStep.step_30.sent).toBe(0)
    expect(m.sent).toBe(2)
  })

  it("language=en lit la prop user.language", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("john@x.com"), language: "en" })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(emailService.sendInvoiceReminder).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en" }),
    )
  })

  it("language=fr fallback si user.language non-supporte", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("x@y.com"), language: "es" }) // pas supporte
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(emailService.sendInvoiceReminder).toHaveBeenCalledWith(
      expect.objectContaining({ language: "fr" }),
    )
  })

  it("audit per-reminder INVOICE_REMINDER kind=sent + step + emailMessageId", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("john@x.com") })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    const sentAudit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === REMINDER_AUDIT_KIND.SENT
    })
    expect(sentAudit).toBeDefined()
    const meta = (sentAudit![0].data as any).metadata
    expect(meta.step).toBe("step_7")
    expect(meta.emailMessageId).toBe("resend-msg-1")
  })

  it("sentToEnc chiffré AES-256-GCM (pas plaintext en BDD)", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("plaintext@example.com") })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    const reminderData = prismaMock.invoiceReminder.create.mock.calls[0]![0]!.data as any
    expect(reminderData.sentToEnc).toBeTruthy()
    expect(reminderData.sentToEnc).not.toContain("plaintext@example.com") // chiffré
  })

  it("MAX_INVOICES_PER_RUN cap appliqué (take=500)", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    const call = prismaMock.invoice.findMany.mock.calls[0]![0]!
    expect((call as any).take).toBe(500)
  })
})
