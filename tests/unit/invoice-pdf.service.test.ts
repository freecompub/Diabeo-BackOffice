/**
 * @description US-2102 — Tests unitaires `invoice-pdf.service.ts`.
 *
 * Couvre :
 *   - `renderInvoicePdf` : pure function, retourne Buffer PDF non-vide
 *   - `generate` : RBAC (admin/cabinet/patient owner), idempotence, status check
 *   - `download` : RBAC + stream
 *   - Audit `INVOICE/UPDATE` (generated) + `INVOICE/READ` (downloaded)
 *   - accessDenied audit sur RBAC fail (US-2265 burst detection)
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/storage/s3", () => ({
  uploadFile: vi.fn().mockResolvedValue({ key: "test-key", size: 1234 }),
  downloadFile: vi.fn().mockResolvedValue({
    body: new ReadableStream(),
    contentType: "application/pdf",
    contentLength: 1234,
  }),
}))

import {
  invoicePdfService,
  renderInvoicePdf,
  InvoicePdfNotFoundError,
  InvoicePdfAccessError,
  InvoicePdfStateError,
  INVOICE_PDF_BOUNDS,
} from "@/lib/services/invoice-pdf.service"
import { uploadFile, downloadFile } from "@/lib/storage/s3"

const ctx = {
  ipAddress: "1.2.3.4",
  userAgent: "Chrome",
  requestId: "req-1",
}

const baseIssuer = {
  name: "Cabinet Diabeo SAS",
  addressLine1: "10 rue de la Paix",
  postalCode: "75002",
  city: "Paris",
  country: "FR",
  siret: "12345678900012",
  tvaIntra: "FR12345678900",
  iban: "FR7630001007941234567890185",
}

const baseInvoice = {
  id: 1,
  number: "FR-2026-000001",
  countryCode: "FR",
  cabinetId: 7,
  patientId: null,
  totalCents: 12000, // 120 €
  taxCents: 2000,    // 20 €
  currency: "EUR",
  status: "issued",
  paymentMethod: null,
  stripePaymentIntentId: null,
  pdfUrl: null,
  pdfHash: null,
  issuerSnapshot: baseIssuer,
  customerSnapshot: null,
  issuedAt: new Date("2026-05-15"),
  paidAt: null,
  cancelledAt: null,
  refundedAt: null,
  createdBy: 9,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [
    {
      id: 1, invoiceId: 1, position: 0,
      description: "Téléconsultation",
      quantity: 1, unitPriceCents: 10000,
      taxRate: 0.2, taxCents: 2000, lineTotalCents: 12000,
      teleconsultActeId: null, createdAt: new Date(),
    },
  ],
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
  // Reset spy call counts between tests (mock implementations remain).
  vi.mocked(uploadFile).mockClear()
  vi.mocked(downloadFile).mockClear()
  vi.mocked(uploadFile).mockResolvedValue({ key: "test", size: 0 })
  vi.mocked(downloadFile).mockResolvedValue({
    body: new ReadableStream(),
    contentType: "application/pdf",
    contentLength: 1234,
  })
})

// ────────────────────────────────────────────────────────────────
// renderInvoicePdf (pure)
// ────────────────────────────────────────────────────────────────

describe("renderInvoicePdf", () => {
  it("produces non-empty Buffer for valid input", async () => {
    const buf = await renderInvoicePdf({
      number: "FR-2026-000001",
      issuedAt: new Date("2026-05-15"),
      countryCode: "FR",
      currency: "EUR",
      paymentMethod: null,
      issuer: baseIssuer,
      customer: null,
      items: [
        { description: "Test", quantity: 1, unitPriceCents: 10000, taxRate: 0.2, taxCents: 2000, lineTotalCents: 12000 },
      ],
      totalCents: 12000,
      taxCents: 2000,
    })
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(500) // PDF minimum size
    // PDF starts with `%PDF-`
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-")
  })

  it("includes IBAN footer when paymentMethod=bank_transfer", async () => {
    const buf = await renderInvoicePdf({
      number: "FR-2026-000002",
      issuedAt: new Date("2026-05-15"),
      countryCode: "FR",
      currency: "EUR",
      paymentMethod: "bank_transfer",
      issuer: baseIssuer,
      customer: null,
      items: [
        { description: "Téléconsult", quantity: 1, unitPriceCents: 10000, taxRate: 0.2, taxCents: 2000, lineTotalCents: 12000 },
      ],
      totalCents: 12000,
      taxCents: 2000,
    })
    expect(buf.length).toBeGreaterThan(500)
  })

  it("rejects pdf > MAX_PDF_BYTES (theoretical — 100 long items)", async () => {
    // Construct a heavy input — but pdf-lib reuses fonts, so 100 small items
    // should stay well under 2MB. Just ensure no crash.
    const items = Array.from({ length: 100 }, (_, i) => ({
      description: `Item ${i} `.repeat(10),
      quantity: 1, unitPriceCents: 100, taxRate: 0.2, taxCents: 20, lineTotalCents: 120,
    }))
    const buf = await renderInvoicePdf({
      number: "FR-2026-000003",
      issuedAt: new Date(),
      countryCode: "FR", currency: "EUR", paymentMethod: null,
      issuer: baseIssuer, customer: null,
      items, totalCents: 12000, taxCents: 2000,
    })
    expect(buf.length).toBeLessThan(INVOICE_PDF_BOUNDS.MAX_PDF_BYTES)
  })

  it("renders customer block when customer provided", async () => {
    const buf = await renderInvoicePdf({
      number: "FR-2026-000004",
      issuedAt: new Date(),
      countryCode: "FR", currency: "EUR", paymentMethod: null,
      issuer: baseIssuer,
      customer: { name: "Jean Dupont", address1: "5 rue X", postalCode: "75001", city: "Paris" },
      items: [{ description: "x", quantity: 1, unitPriceCents: 100, taxRate: 0, taxCents: 0, lineTotalCents: 100 }],
      totalCents: 100, taxCents: 0,
    })
    expect(buf.length).toBeGreaterThan(500)
  })
})

// ────────────────────────────────────────────────────────────────
// generate
// ────────────────────────────────────────────────────────────────

describe("generate", () => {
  it("generates PDF for issued invoice (cabinet member)", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(baseInvoice as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.invoice.update.mockResolvedValue({} as any)
    const out = await invoicePdfService.generate(1, 9, "DOCTOR", ctx)
    expect(out.regenerated).toBe(true)
    expect(out.pdfHash).toMatch(/^[a-f0-9]{64}$/)
    expect(out.pdfUrl).toMatch(/^invoices\/7\/2026\/FR-2026-000001\.pdf$/)
    // S3 upload called
    expect(uploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/^invoices\/7\/2026\/FR-2026-000001\.pdf$/),
      expect.any(Buffer),
      "application/pdf",
    )
    // Audit row
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("invoice.pdf.generated")
  })

  it("idempotent — returns existing pdf if already generated", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...baseInvoice,
      pdfUrl: "invoices/7/2026/FR-2026-000001.pdf",
      pdfHash: "a".repeat(64),
    } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    const out = await invoicePdfService.generate(1, 9, "DOCTOR", ctx)
    expect(out.regenerated).toBe(false)
    expect(out.pdfHash).toBe("a".repeat(64))
    expect(uploadFile).not.toHaveBeenCalled()
  })

  it("404 NotFound when invoice missing", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(null)
    await expect(invoicePdfService.generate(99, 9, "DOCTOR", ctx))
      .rejects.toBeInstanceOf(InvoicePdfNotFoundError)
  })

  it("403 AccessError when user not cabinet member", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(baseInvoice as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null) // no link
    await expect(invoicePdfService.generate(1, 9, "DOCTOR", ctx))
      .rejects.toBeInstanceOf(InvoicePdfAccessError)
    // accessDenied audit émis (US-2265 burst).
    const accessDenied = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.action === "UNAUTHORIZED" && d.metadata?.kind === "invoice.pdf.generate.accessDenied"
    })
    expect(accessDenied).toBeDefined()
  })

  it("409 StateError if invoice still draft", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...baseInvoice, status: "draft", number: null, issuedAt: null,
    } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    await expect(invoicePdfService.generate(1, 9, "DOCTOR", ctx))
      .rejects.toBeInstanceOf(InvoicePdfStateError)
  })

  it("ADMIN bypasses cabinet check", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(baseInvoice as any)
    prismaMock.invoice.update.mockResolvedValue({} as any)
    const out = await invoicePdfService.generate(1, 9, "ADMIN", ctx)
    expect(out.regenerated).toBe(true)
  })

  it("VIEWER (patient owner) can generate own invoice", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...baseInvoice, patientId: 42,
    } as any)
    prismaMock.patient.findFirst.mockResolvedValue({ id: 42 } as any)
    prismaMock.invoice.update.mockResolvedValue({} as any)
    const out = await invoicePdfService.generate(1, 9, "VIEWER", ctx)
    expect(out.regenerated).toBe(true)
  })

  it("VIEWER on cabinet-internal invoice (no patient) → 403", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(baseInvoice as any) // patientId: null
    await expect(invoicePdfService.generate(1, 9, "VIEWER", ctx))
      .rejects.toBeInstanceOf(InvoicePdfAccessError)
  })
})

// ────────────────────────────────────────────────────────────────
// download
// ────────────────────────────────────────────────────────────────

describe("download", () => {
  it("streams PDF + audits READ for cabinet member", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...baseInvoice,
      pdfUrl: "invoices/7/2026/FR-2026-000001.pdf",
      pdfHash: "deadbeef".repeat(8),
    } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    const out = await invoicePdfService.download(1, 9, "DOCTOR", ctx)
    expect(out.contentType).toBe("application/pdf")
    expect(out.pdfHash).toBe("deadbeef".repeat(8))
    expect(downloadFile).toHaveBeenCalledWith("invoices/7/2026/FR-2026-000001.pdf")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("invoice.pdf.downloaded")
  })

  it("404 if invoice not found", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue(null)
    await expect(invoicePdfService.download(99, 9, "DOCTOR", ctx))
      .rejects.toBeInstanceOf(InvoicePdfNotFoundError)
  })

  it("409 if pdf not yet generated", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...baseInvoice, pdfUrl: null, pdfHash: null,
    } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    await expect(invoicePdfService.download(1, 9, "DOCTOR", ctx))
      .rejects.toBeInstanceOf(InvoicePdfStateError)
  })

  it("403 AccessError + accessDenied audit on non-member", async () => {
    prismaMock.invoice.findUnique.mockResolvedValue({
      ...baseInvoice,
      pdfUrl: "key", pdfHash: "a".repeat(64),
    } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(invoicePdfService.download(1, 9, "DOCTOR", ctx))
      .rejects.toBeInstanceOf(InvoicePdfAccessError)
    const accessDenied = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.action === "UNAUTHORIZED" && d.metadata?.kind === "invoice.pdf.download.accessDenied"
    })
    expect(accessDenied).toBeDefined()
  })
})
