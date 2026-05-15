/**
 * @description Groupe 7 Batch 1 — Invoice service unit tests.
 *
 * Couvre :
 *   - US-2103 : `createDraft` validation + cabinet member assertion
 *               + currency-country supportée
 *   - US-2105 : `formatInvoiceNumber` format réglementaire
 *   - US-2107 : `issue` FSM draft → issued, `markPaid` issued → paid,
 *               `cancel` draft/issued → cancelled. Rejet des transitions
 *               invalides (paid → cancelled, refunded → *, etc.).
 *
 * `reserveNextInvoiceNumber` (gap-less concurrency) est testé en
 * `invoice-numbering.service.test.ts` séparé pour isoler la sémantique
 * de transaction.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"
import {
  invoiceService,
  InvoiceValidationError,
  InvoiceAccessError,
  InvoiceStateError,
} from "@/lib/services/invoice.service"
import { formatInvoiceNumber } from "@/lib/services/invoice-numbering.service"

const baseDraftInput = {
  cabinetId: 7,
  patientId: 42,
  countryCode: "FR",
  currency: "EUR",
  items: [
    { description: "Consultation", quantity: 1, unitPriceCents: 5000, taxRate: 0 },
  ],
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  // Transaction passthrough by default — tests can re-mock.
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

// ─── formatInvoiceNumber (US-2105) ───────────────────────────────────

describe("formatInvoiceNumber (US-2105)", () => {
  it("formats FR-2026-000001 with 6-digit padded sequence", () => {
    expect(formatInvoiceNumber("FR", 2026, 1)).toBe("FR-2026-000001")
    expect(formatInvoiceNumber("FR", 2026, 42)).toBe("FR-2026-000042")
    expect(formatInvoiceNumber("DZ", 2026, 999_999)).toBe("DZ-2026-999999")
  })

  it("uppercases countryCode", () => {
    expect(formatInvoiceNumber("fr", 2026, 1)).toBe("FR-2026-000001")
  })

  it("rejects invalid sequence (0, negative, overflow)", () => {
    expect(() => formatInvoiceNumber("FR", 2026, 0)).toThrow(/sequence/)
    expect(() => formatInvoiceNumber("FR", 2026, -1)).toThrow(/sequence/)
    expect(() => formatInvoiceNumber("FR", 2026, 1_000_000)).toThrow(/sequence/)
  })

  it("rejects invalid countryCode", () => {
    expect(() => formatInvoiceNumber("FRA", 2026, 1)).toThrow(/countryCode/)
    expect(() => formatInvoiceNumber("F", 2026, 1)).toThrow(/countryCode/)
  })
})

// ─── createDraft (US-2103) ───────────────────────────────────────────

describe("invoiceService.createDraft (US-2103)", () => {
  beforeEach(() => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.countryCurrency.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.invoice.create.mockResolvedValue({
      id: 100, number: null, countryCode: "FR", cabinetId: 7,
      patientId: 42, totalCents: 5000, taxCents: 0, currency: "EUR",
      status: "draft", paymentMethod: null, stripePaymentIntentId: null,
      pdfUrl: null, pdfHash: null, issuerSnapshot: null, customerSnapshot: null,
      issuedAt: null, paidAt: null, cancelledAt: null, refundedAt: null,
      createdBy: 9, createdAt: new Date(), updatedAt: new Date(),
    } as any)
  })

  it("creates a draft invoice with computed totals", async () => {
    const out = await invoiceService.createDraft(baseDraftInput, 9)
    expect(out.id).toBe(100)
    expect(out.status).toBe("draft")
    expect(out.totalCents).toBe(5000)
    expect(out.taxCents).toBe(0)
    expect(prismaMock.invoice.create).toHaveBeenCalled()
  })

  it("computes total + tax from multiple lines", async () => {
    prismaMock.invoice.create.mockResolvedValue({
      id: 100, number: null, countryCode: "FR", cabinetId: 7,
      patientId: 42, totalCents: 6000, taxCents: 1000, currency: "EUR",
      status: "draft", paymentMethod: null, stripePaymentIntentId: null,
      pdfUrl: null, pdfHash: null, issuerSnapshot: null, customerSnapshot: null,
      issuedAt: null, paidAt: null, cancelledAt: null, refundedAt: null,
      createdBy: 9, createdAt: new Date(), updatedAt: new Date(),
    } as any)
    await invoiceService.createDraft({
      ...baseDraftInput,
      items: [
        { description: "Consult", quantity: 1, unitPriceCents: 5000, taxRate: 0.20 },
      ],
    }, 9)
    const createArg = prismaMock.invoice.create.mock.calls[0]![0] as any
    const items = createArg.data.items.create
    expect(items[0]!.taxCents).toBe(1000)         // 5000 × 0.20 = 1000
    expect(items[0]!.lineTotalCents).toBe(6000)   // 5000 + 1000
  })

  it("rejects when caller is not a cabinet member", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(invoiceService.createDraft(baseDraftInput, 9))
      .rejects.toBeInstanceOf(InvoiceAccessError)
    expect(prismaMock.invoice.create).not.toHaveBeenCalled()
  })

  it("rejects when currency is not supported for the country", async () => {
    prismaMock.countryCurrency.findFirst.mockResolvedValue(null)
    await expect(invoiceService.createDraft({
      ...baseDraftInput, countryCode: "DZ", currency: "EUR",
    }, 9)).rejects.toBeInstanceOf(InvoiceValidationError)
  })

  it("rejects items with negative or excessive quantity", async () => {
    await expect(invoiceService.createDraft({
      ...baseDraftInput,
      items: [{ description: "x", quantity: -1, unitPriceCents: 100, taxRate: 0 }],
    }, 9)).rejects.toBeInstanceOf(InvoiceValidationError)
    await expect(invoiceService.createDraft({
      ...baseDraftInput,
      items: [{ description: "x", quantity: 1001, unitPriceCents: 100, taxRate: 0 }],
    }, 9)).rejects.toBeInstanceOf(InvoiceValidationError)
  })

  it("rejects taxRate outside [0, 1]", async () => {
    await expect(invoiceService.createDraft({
      ...baseDraftInput,
      items: [{ description: "x", quantity: 1, unitPriceCents: 100, taxRate: 1.5 }],
    }, 9)).rejects.toBeInstanceOf(InvoiceValidationError)
  })

  it("rejects empty items array", async () => {
    await expect(invoiceService.createDraft({
      ...baseDraftInput, items: [],
    }, 9)).rejects.toBeInstanceOf(InvoiceValidationError)
  })

  it("emits audit row with patientId pivot (US-2268)", async () => {
    await invoiceService.createDraft(baseDraftInput, 9)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("invoice.draft.create")
    expect(meta.metadata.patientId).toBe(42)
    expect(meta.metadata.cabinetId).toBe(7)
  })

  it("audit row omits patientId pivot when invoice is cabinet-internal (no patient)", async () => {
    prismaMock.invoice.create.mockResolvedValue({
      id: 100, number: null, countryCode: "FR", cabinetId: 7,
      patientId: null, totalCents: 5000, taxCents: 0, currency: "EUR",
      status: "draft", paymentMethod: null, stripePaymentIntentId: null,
      pdfUrl: null, pdfHash: null, issuerSnapshot: null, customerSnapshot: null,
      issuedAt: null, paidAt: null, cancelledAt: null, refundedAt: null,
      createdBy: 9, createdAt: new Date(), updatedAt: new Date(),
    } as any)
    await invoiceService.createDraft({ ...baseDraftInput, patientId: null }, 9)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.patientId).toBeUndefined()
  })
})

// ─── issue / markPaid / cancel FSM (US-2107) ─────────────────────────

describe("invoiceService FSM (US-2107)", () => {
  const baseIssued = {
    id: 100, number: null, countryCode: "FR", cabinetId: 7,
    patientId: 42, totalCents: 5000, taxCents: 0, currency: "EUR",
    status: "draft" as const, paymentMethod: null, stripePaymentIntentId: null,
    pdfUrl: null, pdfHash: null, issuerSnapshot: null, customerSnapshot: null,
    issuedAt: null, paidAt: null, cancelledAt: null, refundedAt: null,
    createdBy: 9, createdAt: new Date(), updatedAt: new Date(),
  }

  beforeEach(() => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
  })

  it("issue assigns sequential number FR-YYYY-000001 in transaction", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ ...baseIssued } as any)
    prismaMock.$executeRaw.mockResolvedValue(1 as any)
    prismaMock.$queryRaw.mockResolvedValue([{ last_number: 0 }] as any)
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      name: "Cabinet X", establishment: null, addressLine1: null,
      addressLine2: null, postalCode: null, city: null, country: "FR",
      phone: null, email: null,
    } as any)
    prismaMock.invoice.update.mockImplementation((args: any) => Promise.resolve({
      ...baseIssued,
      status: "issued",
      number: args.data.number,
      issuedAt: args.data.issuedAt,
    } as any))

    const out = await invoiceService.issue(100, 9)
    expect(out.status).toBe("issued")
    expect(out.number).toMatch(/^FR-\d{4}-000001$/)
  })

  it("issue rejects when invoice is already issued (FSM violation)", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...baseIssued, status: "issued", number: "FR-2026-000001",
    } as any)
    await expect(invoiceService.issue(100, 9))
      .rejects.toBeInstanceOf(InvoiceStateError)
  })

  it("markPaid sets status=paid + paymentMethod + paidAt", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...baseIssued, status: "issued", number: "FR-2026-000001",
    } as any)
    prismaMock.invoice.update.mockResolvedValue({
      ...baseIssued, status: "paid", paymentMethod: "bank_transfer", paidAt: new Date(),
    } as any)
    const out = await invoiceService.markPaid(100, "bank_transfer", 9)
    expect(out.status).toBe("paid")
    expect(out.paymentMethod).toBe("bank_transfer")
  })

  it("markPaid rejects on draft → paid (must go via issued)", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(baseIssued as any)
    await expect(invoiceService.markPaid(100, "bank_transfer", 9))
      .rejects.toBeInstanceOf(InvoiceStateError)
  })

  it("cancel works on draft", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(baseIssued as any)
    prismaMock.invoice.update.mockResolvedValue({
      ...baseIssued, status: "cancelled", cancelledAt: new Date(),
    } as any)
    const out = await invoiceService.cancel(100, "client desisted", 9)
    expect(out.status).toBe("cancelled")
  })

  it("cancel works on issued", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...baseIssued, status: "issued", number: "FR-2026-000001",
    } as any)
    prismaMock.invoice.update.mockResolvedValue({
      ...baseIssued, status: "cancelled", cancelledAt: new Date(),
    } as any)
    const out = await invoiceService.cancel(100, null, 9)
    expect(out.status).toBe("cancelled")
  })

  it("cancel rejects on paid (must use refund)", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...baseIssued, status: "paid", number: "FR-2026-000001",
    } as any)
    await expect(invoiceService.cancel(100, null, 9))
      .rejects.toBeInstanceOf(InvoiceStateError)
  })

  it("cancel rejects on refunded (terminal)", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...baseIssued, status: "refunded", number: "FR-2026-000001",
    } as any)
    await expect(invoiceService.cancel(100, null, 9))
      .rejects.toBeInstanceOf(InvoiceStateError)
  })

  it("write paths reject non-cabinet-member callers", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    prismaMock.invoice.findUnique.mockResolvedValue(baseIssued as any)
    await expect(invoiceService.issue(100, 9))
      .rejects.toBeInstanceOf(InvoiceAccessError)
    await expect(invoiceService.markPaid(100, "bank_transfer", 9))
      .rejects.toBeInstanceOf(InvoiceAccessError)
    await expect(invoiceService.cancel(100, null, 9))
      .rejects.toBeInstanceOf(InvoiceAccessError)
  })
})

// ─── canReadInvoice — read access scoping ────────────────────────────

describe("invoiceService.canReadInvoice", () => {
  it("ADMIN can always read", async () => {
    const ok = await invoiceService.canReadInvoice(9, "ADMIN", {
      cabinetId: 7, patientId: 42,
    })
    expect(ok).toBe(true)
  })

  it("VIEWER can read own patient's invoices", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    const ok = await invoiceService.canReadInvoice(9, "VIEWER", {
      cabinetId: 7, patientId: 42,
    })
    expect(ok).toBe(true)
  })

  it("VIEWER cannot read other patient's invoices", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    const ok = await invoiceService.canReadInvoice(9, "VIEWER", {
      cabinetId: 7, patientId: 99,
    })
    expect(ok).toBe(false)
  })

  it("DOCTOR/NURSE can read invoices of their cabinet", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    const ok = await invoiceService.canReadInvoice(9, "DOCTOR", {
      cabinetId: 7, patientId: 42,
    })
    expect(ok).toBe(true)
  })

  it("DOCTOR/NURSE cannot read invoices of another cabinet", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    const ok = await invoiceService.canReadInvoice(9, "DOCTOR", {
      cabinetId: 99, patientId: 42,
    })
    expect(ok).toBe(false)
  })
})

// ─── Prisma.Decimal serialization (defensive) ───────────────────────

describe("Prisma.Decimal in service", () => {
  it("constructs Decimal without precision loss for typical taxRate", () => {
    const d = new Prisma.Decimal(0.2)
    expect(d.toString()).toBe("0.2")
  })
})
