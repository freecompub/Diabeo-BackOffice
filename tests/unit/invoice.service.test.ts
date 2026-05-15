/**
 * @description Groupe 7 Batch 1 — Invoice service unit tests.
 *
 * Couvre :
 *   - US-2103 : `createDraft` validation + cabinet member + country/
 *     currency cohérent (H2 review)
 *   - US-2105 : `formatInvoiceNumber` format réglementaire
 *   - US-2107 : `issue` FSM draft → issued (atomique updateMany H4),
 *     `markPaid` issued → paid, `cancel` draft/issued → cancelled.
 *     Rejet transitions invalides (paid → cancelled, refunded → *).
 *   - Snapshots immuables (C2 + H3 + H7 review) : SIRET obligatoire FR,
 *     patient name déchiffré, cabinet/patient introuvable bloque issue.
 *   - Access control (C3 + H5 review) : `getById` access-denied audit,
 *     `canReadInvoice` ADMIN / VIEWER own / DOCTOR cabinet.
 *   - List scoping (M5 review) : `listByCabinet` non-member rejette,
 *     `listByPatient` cross-patient bloqué.
 *   - Audit metadata pivots (M6 + US-2268) : `kind: invoice.*`,
 *     `cabinetId` / `patientId` pivots cohérents.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  invoiceService,
  InvoiceValidationError,
  InvoiceAccessError,
  InvoiceStateError,
  InvoiceConcurrencyError,
  INVOICE_BOUNDS,
  decryptCustomerSnapshot,
} from "@/lib/services/invoice.service"
import {
  formatInvoiceNumber,
  InvoiceSequenceOverflowError,
} from "@/lib/services/invoice-numbering.service"

// Encrypt firstname/lastname for snapshot test (C2 review).
import { encrypt } from "@/lib/crypto/health-data"
const encryptB64 = (s: string) => Buffer.from(encrypt(s)).toString("base64")

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
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
  // Cabinet par défaut : pays = FR cohérent.
  prismaMock.healthcareService.findUnique.mockResolvedValue({
    country: "FR", name: "Cabinet X", establishment: null,
    addressLine1: null, addressLine2: null, postalCode: null, city: null,
    phone: null, email: null, siret: "12345678901237", // Luhn-valid
    tvaIntra: null, iban: null, licenseNumber: null,
  } as any)
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

  it("computes total + tax from line with TVA 20%", async () => {
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

  // M2/M3 (review PR #406) — arrondi ligne-à-ligne sur quantités décimales.
  it("rounds half-away-from-zero per line (3 lines qty=0.333 unit=100 TVA=20%)", async () => {
    prismaMock.invoice.create.mockResolvedValue({
      id: 100, number: null, countryCode: "FR", cabinetId: 7,
      patientId: 42, totalCents: 0, taxCents: 0, currency: "EUR",
      status: "draft", paymentMethod: null, stripePaymentIntentId: null,
      pdfUrl: null, pdfHash: null, issuerSnapshot: null, customerSnapshot: null,
      issuedAt: null, paidAt: null, cancelledAt: null, refundedAt: null,
      createdBy: 9, createdAt: new Date(), updatedAt: new Date(),
    } as any)
    await invoiceService.createDraft({
      ...baseDraftInput,
      items: Array.from({ length: 3 }, () => ({
        description: "split", quantity: 0.333, unitPriceCents: 100, taxRate: 0.20,
      })),
    }, 9)
    const createArg = prismaMock.invoice.create.mock.calls[0]![0] as any
    const items = createArg.data.items.create
    // Chaque ligne : subtotal=33.3, tax=round(6.66)=7, line=round(33.3)+7=40
    expect(items.length).toBe(3)
    expect(items[0]!.taxCents).toBe(7)
    expect(items[0]!.lineTotalCents).toBe(40)
  })

  it("rejects when caller is not a cabinet member", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(invoiceService.createDraft(baseDraftInput, 9))
      .rejects.toBeInstanceOf(InvoiceAccessError)
    expect(prismaMock.invoice.create).not.toHaveBeenCalled()
  })

  // H2 (review PR #406) — pays cabinet ≠ pays facture rejeté.
  it("rejects when cabinet.country differs from invoice.countryCode (H2)", async () => {
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      country: "DZ", siret: null, name: "Cabinet DZ", establishment: null,
      addressLine1: null, addressLine2: null, postalCode: null, city: null,
      phone: null, email: null, tvaIntra: null, iban: null, licenseNumber: null,
    } as any)
    await expect(invoiceService.createDraft(baseDraftInput, 9))
      .rejects.toMatchObject({ field: "countryMismatchCabinet:DZ" })
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

  // M4 (review PR #406) — borne totalCents 10 M€.
  it("rejects when total exceeds MAX_TOTAL_CENTS (10 M€)", async () => {
    await expect(invoiceService.createDraft({
      ...baseDraftInput,
      items: Array.from({ length: 100 }, () => ({
        description: "huge",
        quantity: 1000,
        unitPriceCents: INVOICE_BOUNDS.MAX_UNIT_PRICE_CENTS,
        taxRate: 0,
      })),
    }, 9)).rejects.toMatchObject({ field: "totalCentsExceedsMax" })
  })

  it("emits audit row with patientId pivot (US-2268)", async () => {
    await invoiceService.createDraft(baseDraftInput, 9)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("invoice.create")
    expect(meta.metadata.patientId).toBe(42)
    expect(meta.metadata.cabinetId).toBe(7)
  })

  it("audit row omits patientId pivot when invoice is cabinet-internal", async () => {
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

describe("invoiceService FSM (US-2107) — atomic transitions (H4)", () => {
  const baseInvoice = {
    id: 100, number: null, countryCode: "FR", cabinetId: 7,
    patientId: 42, totalCents: 5000, taxCents: 0, currency: "EUR",
    status: "draft" as const, paymentMethod: null, stripePaymentIntentId: null,
    pdfUrl: null, pdfHash: null, issuerSnapshot: null, customerSnapshot: null,
    issuedAt: null, paidAt: null, cancelledAt: null, refundedAt: null,
    createdBy: 9, createdAt: new Date(), updatedAt: new Date(),
  }

  beforeEach(() => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.$executeRaw.mockResolvedValue(1 as any)
    prismaMock.$queryRaw.mockImplementation((sql: any) => {
      // Distinguish reserveNextInvoiceNumber queries by SQL content.
      const text = Array.isArray(sql) ? sql.join("") : String(sql)
      // H-NEW-4 (review re-2) — guard runs always, return fake xid.
      if (text.includes("pg_current_xact_id_if_assigned")) {
        return Promise.resolve([{ xid: "fake-xid" }]) as any
      }
      if (text.includes("last_number")) {
        return Promise.resolve([{ last_number: 0 }]) as any
      }
      return Promise.resolve([]) as any
    })
    prismaMock.invoice.updateMany.mockResolvedValue({ count: 1 } as any)
    // Patient User PII encrypted (for customerSnapshot).
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 42,
      user: {
        firstname: encryptB64("Jean"),
        lastname: encryptB64("Dupont"),
        address1: null, address2: null, cp: null, city: null, email: null,
      },
    } as any)
  })

  it("issue assigns sequential number FR-YYYY-000001 + atomic transition", async () => {
    prismaMock.invoice.findUnique.mockResolvedValueOnce({ ...baseInvoice } as any)
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseInvoice, status: "issued", number: `FR-${new Date().getUTCFullYear()}-000001`,
      issuedAt: new Date(),
    } as any)

    const out = await invoiceService.issue(100, 9)
    expect(out.status).toBe("issued")
    expect(out.number).toMatch(/^FR-\d{4}-000001$/)
    expect(prismaMock.invoice.updateMany).toHaveBeenCalled()
    // H4 — updateMany filtered on status=draft for atomicity.
    const call = prismaMock.invoice.updateMany.mock.calls[0]![0]!
    expect((call.where as any).status).toEqual({ in: ["draft"] })
  })

  it("issue rejects when invoice is already issued (FSM violation)", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...baseInvoice, status: "issued", number: "FR-2026-000001",
    } as any)
    await expect(invoiceService.issue(100, 9))
      .rejects.toBeInstanceOf(InvoiceStateError)
  })

  // H4 + M-NEW-1 (review re-2) — race lost-update : caller a vu "draft"
  // mais entre temps un autre writer a transitionné. Throw
  // InvoiceConcurrencyError (retryable) au lieu de StateError.
  it("issue throws InvoiceConcurrencyError on lost-update race (updateMany count=0)", async () => {
    prismaMock.invoice.findUnique.mockResolvedValueOnce({ ...baseInvoice } as any)
    prismaMock.invoice.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseInvoice, status: "issued",
    } as any)
    await expect(invoiceService.issue(100, 9))
      .rejects.toBeInstanceOf(InvoiceConcurrencyError)
  })

  // H7 (review PR #406) — patient introuvable bloque issue.
  it("issue rejects when patient is soft-deleted / not found", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ ...baseInvoice } as any)
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(invoiceService.issue(100, 9))
      .rejects.toMatchObject({ field: "patientNotFound" })
  })

  // H3 (review PR #406) — SIRET obligatoire pour facture FR.
  it("issue rejects when cabinet has no SIRET on a FR invoice", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ ...baseInvoice } as any)
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      country: "FR", name: "Cabinet X", establishment: null,
      addressLine1: null, addressLine2: null, postalCode: null, city: null,
      phone: null, email: null, siret: null,
      tvaIntra: null, iban: null, licenseNumber: null,
    } as any)
    await expect(invoiceService.issue(100, 9))
      .rejects.toMatchObject({ field: "cabinetSiretRequiredForFR" })
  })

  // C2 + M-NEW-3 (review re-2) — snapshot client chiffré AES-256-GCM
  //   { patientRef, encryptedPii: base64, encryptedAt }
  // `decryptCustomerSnapshot` retrouve `name` après déchiffrement.
  it("issue encrypts customerSnapshot PII (C2 + M-NEW-3)", async () => {
    prismaMock.invoice.findUnique.mockResolvedValueOnce({ ...baseInvoice } as any)
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseInvoice, status: "issued",
      number: `FR-${new Date().getUTCFullYear()}-000001`,
    } as any)
    await invoiceService.issue(100, 9)
    const updateArgs = prismaMock.invoice.updateMany.mock.calls[0]![0]!
    const customerSnap = (updateArgs.data as any).customerSnapshot
    expect(customerSnap.patientRef).toBe("patient#42")
    expect(typeof customerSnap.encryptedPii).toBe("string")
    expect(typeof customerSnap.encryptedAt).toBe("string")
    expect(customerSnap.name).toBeUndefined()
    // Roundtrip : décrypter le snapshot, vérifier le nom.
    const decoded = decryptCustomerSnapshot(customerSnap)
    expect(decoded?.name).toBe("Jean Dupont")
  })

  // C2 — patient sans PII déchiffrable → rejet.
  it("issue rejects when patient name cannot be decrypted", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({ ...baseInvoice } as any)
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 42, user: {
        firstname: null, lastname: null, address1: null, address2: null,
        cp: null, city: null, email: null,
      },
    } as any)
    await expect(invoiceService.issue(100, 9))
      .rejects.toMatchObject({ field: "customerNameUnavailable" })
  })

  it("markPaid sets status=paid + paymentMethod + paidAt (atomic)", async () => {
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseInvoice, status: "issued", number: "FR-2026-000001",
    } as any)
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseInvoice, status: "paid", number: "FR-2026-000001",
      paymentMethod: "bank_transfer", paidAt: new Date(),
    } as any)
    const out = await invoiceService.markPaid(100, "bank_transfer", 9)
    expect(out.status).toBe("paid")
    expect(out.paymentMethod).toBe("bank_transfer")
  })

  it("markPaid throws InvoiceConcurrencyError on race (updateMany count=0)", async () => {
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseInvoice, status: "issued",
    } as any)
    prismaMock.invoice.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseInvoice, status: "paid",
    } as any)
    await expect(invoiceService.markPaid(100, "bank_transfer", 9))
      .rejects.toBeInstanceOf(InvoiceConcurrencyError)
  })

  it("cancel works on draft", async () => {
    prismaMock.invoice.findUnique.mockResolvedValueOnce(baseInvoice as any)
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseInvoice, status: "cancelled", cancelledAt: new Date(),
    } as any)
    const out = await invoiceService.cancel(100, "client desisted", 9)
    expect(out.status).toBe("cancelled")
  })

  it("cancel rejects on paid (must use refund)", async () => {
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseInvoice, status: "paid", number: "FR-2026-000001",
    } as any)
    prismaMock.invoice.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseInvoice, status: "paid",
    } as any)
    await expect(invoiceService.cancel(100, null, 9))
      .rejects.toBeInstanceOf(InvoiceStateError)
  })

  it("write paths reject non-cabinet-member callers", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    prismaMock.invoice.findUnique.mockResolvedValue(baseInvoice as any)
    await expect(invoiceService.issue(100, 9))
      .rejects.toBeInstanceOf(InvoiceAccessError)
    await expect(invoiceService.markPaid(100, "bank_transfer", 9))
      .rejects.toBeInstanceOf(InvoiceAccessError)
    await expect(invoiceService.cancel(100, null, 9))
      .rejects.toBeInstanceOf(InvoiceAccessError)
  })
})

// ─── getById — fetch → canRead → audit READ/accessDenied ────────────

describe("invoiceService.getById (C3 + H5 access-aware)", () => {
  const baseInvoice = {
    id: 100, number: "FR-2026-000001", countryCode: "FR", cabinetId: 7,
    patientId: 42, totalCents: 5000, taxCents: 0, currency: "EUR",
    status: "issued", paymentMethod: null, stripePaymentIntentId: null,
    pdfUrl: null, pdfHash: null, issuerSnapshot: null, customerSnapshot: null,
    issuedAt: new Date(), paidAt: null, cancelledAt: null, refundedAt: null,
    createdBy: 9, createdAt: new Date(), updatedAt: new Date(),
    items: [],
  }

  it("returns null + emits accessDenied audit when VIEWER not patient owner", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(baseInvoice as any)
    prismaMock.patient.findFirst.mockResolvedValue(null) // not own patient
    const out = await invoiceService.getById(100, 9, "VIEWER")
    expect(out).toBeNull()
    const lastAudit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(lastAudit.action).toBe("UNAUTHORIZED")
    expect(lastAudit.metadata.kind).toBe("invoice.read.denied")
  })

  it("returns invoice + emits READ when ADMIN", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(baseInvoice as any)
    const out = await invoiceService.getById(100, 9, "ADMIN")
    expect(out?.id).toBe(100)
    const lastAudit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(lastAudit.action).toBe("READ")
    expect(lastAudit.metadata.kind).toBe("invoice.read")
    expect(lastAudit.metadata.patientId).toBe(42)
  })

  it("returns null without any audit when invoice does not exist", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(null)
    const out = await invoiceService.getById(999, 9, "DOCTOR")
    expect(out).toBeNull()
    // No audit row emitted.
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled()
  })
})

// ─── List scoping (M5/M6 review) ─────────────────────────────────────

describe("invoiceService.list scoping (M5 + M6)", () => {
  it("listByCabinet enforces cabinet membership for DOCTOR/NURSE", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(invoiceService.listByCabinet(7, {}, 9, "DOCTOR"))
      .rejects.toBeInstanceOf(InvoiceAccessError)
  })

  it("listByCabinet bypasses membership for ADMIN", async () => {
    prismaMock.invoice.findMany.mockResolvedValue([] as any)
    const out = await invoiceService.listByCabinet(7, {}, 9, "ADMIN")
    expect(out).toEqual([])
    // membership query never executed.
    expect(prismaMock.healthcareMember.findFirst).not.toHaveBeenCalled()
  })

  it("listByCabinet audit omits resourceId, uses metadata.cabinetId pivot", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.invoice.findMany.mockResolvedValue([] as any)
    await invoiceService.listByCabinet(7, {}, 9, "DOCTOR")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.resourceId).toBeNull()
    expect(meta.metadata.kind).toBe("invoice.list.cabinet")
    expect(meta.metadata.cabinetId).toBe(7)
  })

  it("listByPatient rejects VIEWER cross-patient access", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(invoiceService.listByPatient(42, {}, 9, "VIEWER"))
      .rejects.toBeInstanceOf(InvoiceAccessError)
  })

  it("listByPatient rejects DOCTOR without PatientService link", async () => {
    prismaMock.patientService.findFirst.mockResolvedValue(null)
    await expect(invoiceService.listByPatient(42, {}, 9, "DOCTOR"))
      .rejects.toBeInstanceOf(InvoiceAccessError)
  })

  it("listByPatient audit uses metadata.patientId pivot (US-2268)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.invoice.findMany.mockResolvedValue([] as any)
    await invoiceService.listByPatient(42, {}, 9, "VIEWER")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("invoice.list.patient")
    expect(meta.metadata.patientId).toBe(42)
  })
})

// ─── canReadInvoice (M7 typed Role) ──────────────────────────────────

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

// ─── Sequence overflow (M10 typed error) ─────────────────────────────

describe("InvoiceSequenceOverflowError class (M10)", () => {
  it("is exported and contains country/year/last", () => {
    const e = new InvoiceSequenceOverflowError("FR", 2099, 999_999)
    expect(e.name).toBe("InvoiceSequenceOverflowError")
    expect(e.countryCode).toBe("FR")
    expect(e.year).toBe(2099)
    expect(e.last).toBe(999_999)
  })
})

// ─── Review re-2 — Re-review findings (HIGH + MEDIUM + LOW) ──────────

describe("Re-review fixes (H-NEW + M-NEW + L-NEW)", () => {
  beforeEach(() => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.$executeRaw.mockResolvedValue(1 as any)
    prismaMock.$queryRaw.mockImplementation((sql: any) => {
      const text = Array.isArray(sql) ? sql.join("") : String(sql)
      if (text.includes("pg_current_xact_id_if_assigned")) {
        return Promise.resolve([{ xid: "fake-xid" }]) as any
      }
      if (text.includes("last_number")) {
        return Promise.resolve([{ last_number: 0 }]) as any
      }
      return Promise.resolve([]) as any
    })
    prismaMock.invoice.updateMany.mockResolvedValue({ count: 1 } as any)
    prismaMock.patient.findFirst.mockResolvedValue({
      id: 42,
      user: {
        firstname: encryptB64("Jean"),
        lastname: encryptB64("Dupont"),
        address1: null, address2: null, cp: null, city: null, email: null,
      },
    } as any)
  })

  // H-NEW-1 — SIRET Luhn validation côté service.
  it("H-NEW-1 issue rejects SIRET with valid format but invalid Luhn checksum", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      id: 100, number: null, countryCode: "FR", cabinetId: 7,
      patientId: 42, totalCents: 5000, taxCents: 0, currency: "EUR",
      status: "draft", paymentMethod: null, stripePaymentIntentId: null,
      pdfUrl: null, pdfHash: null, issuerSnapshot: null, customerSnapshot: null,
      issuedAt: null, paidAt: null, cancelledAt: null, refundedAt: null,
      createdBy: 9, createdAt: new Date(), updatedAt: new Date(),
    } as any)
    // 14 zeros : Luhn-invalid (sum=0, 0%10=0 mais pas le critère Luhn ici).
    // En fait Math.round(0) % 10 = 0 → Luhn passe. Utilise "12345678901234"
    // qui a un mauvais checksum (le bon SIRET de test serait "73282932000074").
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      country: "FR", name: "Cabinet X", establishment: null,
      addressLine1: null, addressLine2: null, postalCode: null, city: null,
      phone: null, email: null,
      siret: "12345678901234", // Luhn-invalid
      tvaIntra: null, iban: null, licenseNumber: null,
    } as any)
    await expect(invoiceService.issue(100, 9))
      .rejects.toMatchObject({ field: expect.stringContaining("cabinetSiretInvalid") })
  })

  // H-NEW-1 — un SIRET valide Luhn passe.
  it("H-NEW-1 issue accepts SIRET with valid Luhn checksum", async () => {
    const baseInv = {
      id: 100, number: null, countryCode: "FR", cabinetId: 7,
      patientId: 42, totalCents: 5000, taxCents: 0, currency: "EUR",
      status: "draft" as const, paymentMethod: null, stripePaymentIntentId: null,
      pdfUrl: null, pdfHash: null, issuerSnapshot: null, customerSnapshot: null,
      issuedAt: null, paidAt: null, cancelledAt: null, refundedAt: null,
      createdBy: 9, createdAt: new Date(), updatedAt: new Date(),
    }
    prismaMock.invoice.findUnique.mockResolvedValueOnce(baseInv as any)
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseInv, status: "issued",
      number: `FR-${new Date().getUTCFullYear()}-000001`,
    } as any)
    prismaMock.healthcareService.findUnique.mockResolvedValue({
      country: "FR", name: "Cabinet X", establishment: null,
      addressLine1: null, addressLine2: null, postalCode: null, city: null,
      phone: null, email: null,
      siret: "12345678901237", // SIRET test Luhn-valide
      tvaIntra: null, iban: null, licenseNumber: null,
    } as any)
    const out = await invoiceService.issue(100, 9)
    expect(out.status).toBe("issued")
  })

  // H-NEW-2 — markPaid valide stripePaymentIntentId format.
  it("H-NEW-2 markPaid rejects stripe without valid paymentIntentId", async () => {
    await expect(invoiceService.markPaid(100, "stripe", 9))
      .rejects.toMatchObject({ field: "stripePaymentIntentId" })
    await expect(invoiceService.markPaid(100, "stripe", 9, undefined, "garbage"))
      .rejects.toMatchObject({ field: "stripePaymentIntentId" })
  })

  it("H-NEW-2 markPaid rejects non-stripe with unexpected paymentIntentId", async () => {
    await expect(invoiceService.markPaid(100, "bank_transfer", 9, undefined, "pi_abc123"))
      .rejects.toMatchObject({ field: "stripePaymentIntentIdUnexpected" })
  })

  // M-NEW-1 — concurrency error distinct de state error.
  it("M-NEW-1 markPaid throws InvoiceConcurrencyError when status raced past expected", async () => {
    const baseIssued = {
      id: 100, number: "FR-2026-000001", countryCode: "FR", cabinetId: 7,
      patientId: 42, totalCents: 5000, taxCents: 0, currency: "EUR",
      status: "issued" as const, paymentMethod: null, stripePaymentIntentId: null,
      pdfUrl: null, pdfHash: null, issuerSnapshot: null, customerSnapshot: null,
      issuedAt: new Date(), paidAt: null, cancelledAt: null, refundedAt: null,
      createdBy: 9, createdAt: new Date(), updatedAt: new Date(),
    }
    // T2 lit "issued", mais entre temps T1 a commit "paid".
    prismaMock.invoice.findUnique.mockResolvedValueOnce(baseIssued as any)
    prismaMock.invoice.updateMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseIssued, status: "paid", paymentMethod: "stripe",
    } as any)
    await expect(invoiceService.markPaid(100, "bank_transfer", 9))
      .rejects.toBeInstanceOf(InvoiceConcurrencyError)
  })

  // H-NEW-4 — runtime guard active even in test (mock provides fake xid).
  it("H-NEW-4 reserveNextInvoiceNumber executes guard SQL always (no NODE_ENV bypass)", async () => {
    const baseInv = {
      id: 100, number: null, countryCode: "FR", cabinetId: 7,
      patientId: 42, totalCents: 5000, taxCents: 0, currency: "EUR",
      status: "draft" as const, paymentMethod: null, stripePaymentIntentId: null,
      pdfUrl: null, pdfHash: null, issuerSnapshot: null, customerSnapshot: null,
      issuedAt: null, paidAt: null, cancelledAt: null, refundedAt: null,
      createdBy: 9, createdAt: new Date(), updatedAt: new Date(),
    }
    prismaMock.invoice.findUnique.mockResolvedValueOnce(baseInv as any)
    prismaMock.invoice.findUnique.mockResolvedValueOnce({
      ...baseInv, status: "issued",
      number: `FR-${new Date().getUTCFullYear()}-000001`,
    } as any)
    await invoiceService.issue(100, 9)
    // Vérifier que le guard a été appelé (la SQL `pg_current_xact_id_if_assigned`)
    const queryCalls = prismaMock.$queryRaw.mock.calls
    const guardCall = queryCalls.find((c) => {
      const sql = Array.isArray(c[0]) ? c[0].join("") : String(c[0])
      return sql.includes("pg_current_xact_id_if_assigned")
    })
    expect(guardCall).toBeDefined()
  })

  // L-NEW-5 — ctx propagation dans getById audit.
  it("L-NEW-5 getById propagates ctx (ipAddress, userAgent, requestId) to audit", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      id: 100, number: "FR-2026-000001", countryCode: "FR", cabinetId: 7,
      patientId: 42, totalCents: 5000, taxCents: 0, currency: "EUR",
      status: "issued", paymentMethod: null, stripePaymentIntentId: null,
      pdfUrl: null, pdfHash: null, issuerSnapshot: null, customerSnapshot: null,
      issuedAt: new Date(), paidAt: null, cancelledAt: null, refundedAt: null,
      createdBy: 9, createdAt: new Date(), updatedAt: new Date(),
      items: [],
    } as any)
    const ctx = {
      ipAddress: "1.2.3.4",
      userAgent: "TestUA/1.0",
      requestId: "req-abc",
    }
    await invoiceService.getById(100, 9, "ADMIN", ctx)
    const lastAudit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(lastAudit.ipAddress).toBe("1.2.3.4")
    expect(lastAudit.userAgent).toBe("TestUA/1.0")
    expect(lastAudit.requestId).toBe("req-abc")
  })

  // M-NEW-3 — roundtrip chiffrement/déchiffrement customer_snapshot.
  it("M-NEW-3 decryptCustomerSnapshot returns null on corrupted/missing payload", () => {
    expect(decryptCustomerSnapshot(null)).toBeNull()
    expect(decryptCustomerSnapshot({ patientRef: "patient#42" })).toBeNull()
    expect(decryptCustomerSnapshot({
      patientRef: "patient#42", encryptedPii: "not-base64!", encryptedAt: "x",
    })).toBeNull()
  })
})
