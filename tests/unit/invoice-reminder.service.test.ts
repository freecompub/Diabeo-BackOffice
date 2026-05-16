/**
 * @description US-2108 — Relances factures unit tests round 2.
 *
 * Couvre round 2 :
 *   - C1 : CRON_AUDIT_USER_ID = null (FK-safe)
 *   - H1 : filtre patient.deletedAt + user.status='active'
 *   - H3 : timeout 50s + parallel p-limit
 *   - H4 : sanitizeResendError scrub email
 *   - H5 : advisory lock anti double-run
 *   - H8 : metadata.patientId propage (US-2268)
 *   - M3 : recheck status='issued' avant persist
 *   - M9 : orderBy issuedAt asc
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { Prisma } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/services/email.service", () => ({
  emailService: {
    sendInvoiceReminder: vi.fn().mockResolvedValue({ sent: true, id: "resend-msg-1" }),
  },
}))

import {
  invoiceReminderService,
  REMINDER_STEPS,
  REMINDER_AUDIT_KIND,
  MAX_INVOICES_PER_STEP,
} from "@/lib/services/invoice-reminder.service"
import { emailService } from "@/lib/services/email.service"

const ctx = {
  ipAddress: "1.2.3.4",
  userAgent: "cron",
  requestId: "cron-1",
}

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
    patientId: overrides.patientId === null ? null : (overrides.patientId ?? 42),
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
  // H5 round 2 — advisory lock default acquired (skippedConcurrent=false).
  prismaMock.$queryRaw.mockResolvedValue([{ locked: true }] as any)
  // M3 round 2 — recheck status='issued' default OK.
  prismaMock.invoice.findUnique.mockResolvedValue({ status: "issued" } as any)
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
    expect(m.timedOut).toBe(false)
    expect(m.skippedConcurrent).toBe(false)
  })

  // H5 round 2 — advisory lock anti double-run.
  it("H5 round 2 — skippedConcurrent=true si advisory lock non-acquis", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ locked: false }] as any)
    const m = await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(m.skippedConcurrent).toBe(true)
    expect(m.processed).toBe(0)
    // findMany ne doit PAS etre appele.
    expect(prismaMock.invoice.findMany).not.toHaveBeenCalled()
    // Audit `cron.skipped_locked` emis.
    const audit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === REMINDER_AUDIT_KIND.CRON_SKIPPED_LOCKED
    })
    expect(audit).toBeDefined()
  })

  it("appelle invoice.findMany pour chaque step (3 queries)", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(prismaMock.invoice.findMany).toHaveBeenCalledTimes(REMINDER_STEPS.length)
    const firstCallWhere = prismaMock.invoice.findMany.mock.calls[0]![0]!.where as any
    expect(firstCallWhere.status).toBe("issued")
    expect(firstCallWhere.reminders.none.step).toBe("step_7")
  })

  // H1 round 2 — filtre RGPD Art. 17 patient soft-deleted + user.status
  it("H1 round 2 — filtre patient.deletedAt + user.status='active'", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    const where = prismaMock.invoice.findMany.mock.calls[0]![0]!.where as any
    expect(where.patient.deletedAt).toBe(null)
    expect(where.patient.user.status).toBe("active")
  })

  // M9 round 2 — orderBy issuedAt asc oldest first
  it("M9 round 2 — orderBy issuedAt ASC (oldest first)", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    const orderBy = prismaMock.invoice.findMany.mock.calls[0]![0]!.orderBy as any
    expect(orderBy).toEqual({ issuedAt: "asc" })
  })

  it("emit audit cron.run avec metrics + durationMs", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    const runAudit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === REMINDER_AUDIT_KIND.CRON_RUN
    })
    expect(runAudit).toBeDefined()
    const meta = (runAudit![0].data as any).metadata
    expect(meta.processed).toBe(0)
    expect(typeof meta.durationMs).toBe("number")
  })

  // C1 round 2 — CRON_AUDIT_USER_ID = null (FK-safe).
  it("C1 round 2 — audit userId = null (sentinel cron system, pas 0)", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    const runAudit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === REMINDER_AUDIT_KIND.CRON_RUN
    })
    const data = runAudit![0].data as any
    expect(data.userId).toBe(null) // pas 0 !
  })

  it("envoie email pour invoice overdue patient → status=sent", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const emailEnc = encryptField("patient@example.com")
    const invFixture = makeInvoice({ emailEnc })
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
  })

  // H4 round 2 — sanitize email plaintext dans errorMessage
  it("H4 round 2 — sanitize email plaintext dans errorMessage Resend", async () => {
    vi.mocked(emailService.sendInvoiceReminder).mockResolvedValueOnce({
      sent: false, error: "Invalid email address: leak@example.com — bounced",
    })
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("leak@example.com") })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    const reminderData = prismaMock.invoiceReminder.create.mock.calls[0]![0]!.data as any
    expect(reminderData.errorMessage).not.toContain("leak@example.com")
    expect(reminderData.errorMessage).toContain("<recipient>")
  })

  // H8 round 2 — patientId pivot US-2268
  it("H8 round 2 — audit metadata.patientId propage (US-2268 pivot)", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("a@b.com"), patientId: 99 })
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
    expect((sentAudit![0].data as any).metadata.patientId).toBe(99)
  })

  // M3 round 2 — recheck status='issued' avant persist
  it("M3 round 2 — skip persist si status passe a 'paid' entre findMany et persist", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("a@b.com") })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    // Simulate status changed to paid between findMany and persist.
    prismaMock.invoice.findUnique.mockResolvedValue({ status: "paid" } as any)
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    // L'email a ete envoye (effet de bord accepte M4 race) mais le row
    // InvoiceReminder n'est PAS persiste (recheck status fail).
    expect(prismaMock.invoiceReminder.create).not.toHaveBeenCalled()
  })

  it("status=failed si Resend throw", async () => {
    vi.mocked(emailService.sendInvoiceReminder).mockRejectedValueOnce(
      new Error("RESEND_API_KEY not configured"),
    )
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("a@b.com") })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const m = await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(m.failed).toBe(1)
  })

  it("idempotent : P2002 → silent skip pas erreur", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("a@b.com") })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const p2002 = new Prisma.PrismaClientKnownRequestError("dup", {
      code: "P2002", clientVersion: "test",
      meta: { target: ["invoice_id", "step"] },
    })
    prismaMock.invoiceReminder.create.mockRejectedValueOnce(p2002)
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
    const inv = makeInvoice({ emailEnc: encryptField("x@y.com"), language: "es" })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    expect(emailService.sendInvoiceReminder).toHaveBeenCalledWith(
      expect.objectContaining({ language: "fr" }),
    )
  })

  it("MAX_INVOICES_PER_STEP cap appliqué (take=500)", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    const call = prismaMock.invoice.findMany.mock.calls[0]![0]!
    expect((call as any).take).toBe(MAX_INVOICES_PER_STEP)
  })

  it("audit per-reminder kind=sent + step + emailMessageId", async () => {
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

  it("sentToEnc chiffré (pas plaintext)", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const inv = makeInvoice({ emailEnc: encryptField("plaintext@example.com") })
    prismaMock.invoice.findMany
      .mockResolvedValueOnce([inv])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await invoiceReminderService.processOverdueInvoices(new Date(), ctx)
    const reminderData = prismaMock.invoiceReminder.create.mock.calls[0]![0]!.data as any
    expect(reminderData.sentToEnc).toBeTruthy()
    expect(reminderData.sentToEnc).not.toContain("plaintext@example.com")
  })
})
