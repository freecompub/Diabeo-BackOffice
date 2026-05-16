/**
 * @description US-2102 — Integration tests `/api/billing/invoices/[id]/pdf`.
 *
 * Couvre :
 *   - 401 sans JWT
 *   - 400 invalid id
 *   - 201 POST success (newly generated)
 *   - 200 POST idempotent (already generated)
 *   - 200 GET stream PDF
 *   - 403 forbidden
 *   - 404 not found
 *   - 409 invalid state (draft)
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/services/invoice-pdf.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/invoice-pdf.service")>()
  return {
    ...actual,
    invoicePdfService: {
      generate: vi.fn(),
      download: vi.fn(),
    },
  }
})

import {
  invoicePdfService,
  InvoicePdfNotFoundError,
  InvoicePdfAccessError,
  InvoicePdfStateError,
} from "@/lib/services/invoice-pdf.service"

const { POST: pdfPOST, GET: pdfGET } = await import(
  "@/app/api/billing/invoices/[id]/pdf/route"
)

function makeReq(
  url: string,
  init: RequestInit & { auth?: boolean } = {},
): NextRequest {
  const headers = new Headers(init.headers)
  if (init.auth !== false) {
    headers.set("x-user-id", "1")
    headers.set("x-user-role", "DOCTOR")
  }
  return new NextRequest(new URL(url, "http://test.local"), {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/billing/invoices/[id]/pdf", () => {
  it("401 sans JWT", async () => {
    const res = await pdfPOST(
      makeReq("/api/billing/invoices/1/pdf", { method: "POST", auth: false }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(401)
  })

  it("400 invalid id", async () => {
    const res = await pdfPOST(
      makeReq("/api/billing/invoices/abc/pdf", { method: "POST" }),
      { params: Promise.resolve({ id: "abc" }) },
    )
    expect(res.status).toBe(400)
  })

  it("201 generated successfully", async () => {
    vi.mocked(invoicePdfService.generate).mockResolvedValue({
      pdfUrl: "invoices/7/2026/FR-2026-000001.pdf",
      pdfHash: "a".repeat(64),
      regenerated: true,
    })
    const res = await pdfPOST(
      makeReq("/api/billing/invoices/1/pdf", { method: "POST" }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.regenerated).toBe(true)
    expect(body.pdfHash).toBe("a".repeat(64))
  })

  it("200 idempotent (already generated)", async () => {
    vi.mocked(invoicePdfService.generate).mockResolvedValue({
      pdfUrl: "existing.pdf",
      pdfHash: "b".repeat(64),
      regenerated: false,
    })
    const res = await pdfPOST(
      makeReq("/api/billing/invoices/1/pdf", { method: "POST" }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(200)
  })

  it("404 not found", async () => {
    vi.mocked(invoicePdfService.generate).mockRejectedValue(
      new InvoicePdfNotFoundError(),
    )
    const res = await pdfPOST(
      makeReq("/api/billing/invoices/99/pdf", { method: "POST" }),
      { params: Promise.resolve({ id: "99" }) },
    )
    expect(res.status).toBe(404)
  })

  it("403 forbidden", async () => {
    vi.mocked(invoicePdfService.generate).mockRejectedValue(
      new InvoicePdfAccessError(),
    )
    const res = await pdfPOST(
      makeReq("/api/billing/invoices/1/pdf", { method: "POST" }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(403)
  })

  it("409 invalid state (draft)", async () => {
    vi.mocked(invoicePdfService.generate).mockRejectedValue(
      new InvoicePdfStateError("draft", "issued"),
    )
    const res = await pdfPOST(
      makeReq("/api/billing/invoices/1/pdf", { method: "POST" }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.actual).toBe("draft")
  })

  it("Cache-Control: no-store sur succès", async () => {
    vi.mocked(invoicePdfService.generate).mockResolvedValue({
      pdfUrl: "x", pdfHash: "c".repeat(64), regenerated: true,
    })
    const res = await pdfPOST(
      makeReq("/api/billing/invoices/1/pdf", { method: "POST" }),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })
})

describe("GET /api/billing/invoices/[id]/pdf", () => {
  it("200 streams PDF avec headers corrects", async () => {
    vi.mocked(invoicePdfService.download).mockResolvedValue({
      body: new ReadableStream(),
      contentType: "application/pdf",
      contentLength: 1234,
      pdfHash: "deadbeef".repeat(8),
    })
    const res = await pdfGET(
      makeReq("/api/billing/invoices/1/pdf"),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("application/pdf")
    expect(res.headers.get("Content-Disposition")).toContain("invoice-1.pdf")
    expect(res.headers.get("X-Content-SHA256")).toBe("deadbeef".repeat(8))
    expect(res.headers.get("Cache-Control")).toContain("no-store")
  })

  it("404 si invoice not found", async () => {
    vi.mocked(invoicePdfService.download).mockRejectedValue(
      new InvoicePdfNotFoundError(),
    )
    const res = await pdfGET(
      makeReq("/api/billing/invoices/99/pdf"),
      { params: Promise.resolve({ id: "99" }) },
    )
    expect(res.status).toBe(404)
  })

  it("409 si pdf pas encore généré", async () => {
    vi.mocked(invoicePdfService.download).mockRejectedValue(
      new InvoicePdfStateError("noPdf", "pdf generated"),
    )
    const res = await pdfGET(
      makeReq("/api/billing/invoices/1/pdf"),
      { params: Promise.resolve({ id: "1" }) },
    )
    expect(res.status).toBe(409)
  })
})
