/**
 * @description Garde consentement sur `/api/documents/[id]/download` (frontière
 * de sécu, revue PR #546 ; convergée sur `patientShareConsent`). Vérifie :
 * PRO + consentement refusé → bloqué sans stream ; PRO + ok → sert ;
 * VIEWER → non gaté (accès à ses propres documents).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/access-control", () => ({ resolvePatientId: vi.fn().mockResolvedValue(42) }))

const consentMock = vi.fn()
vi.mock("@/lib/consent", () => ({ patientShareConsent: consentMock }))

const downloadMock = vi.fn()
vi.mock("@/lib/services/document.service", () => ({
  documentService: { download: downloadMock },
}))

vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: () => ({ ipAddress: "127.0.0.1", userAgent: "test", requestId: "r1" }),
}))

const { GET } = await import("@/app/api/documents/[id]/download/route")

function makeReq(role: string, docId = "7", patientId = "42"): NextRequest {
  const headers = new Headers()
  headers.set("x-user-id", "1")
  headers.set("x-user-role", role)
  return new NextRequest(new URL(`/api/documents/${docId}/download?patientId=${patientId}`, "http://test.local"), {
    method: "GET",
    headers,
  })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const okDownload = () =>
  downloadMock.mockResolvedValue({ body: "PDF", contentType: "application/pdf", contentLength: 3, fileName: "doc.pdf" })

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/documents/[id]/download — garde consentement", () => {
  it("PRO + consentement refusé → bloqué (403), pas de stream", async () => {
    consentMock.mockResolvedValue({ ok: false, status: 403, error: "sharingDisabled" })
    const res = await GET(makeReq("DOCTOR"), params("7"))
    expect(res.status).toBe(403)
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it("PRO + consentement OK → sert le document", async () => {
    consentMock.mockResolvedValue({ ok: true })
    okDownload()
    const res = await GET(makeReq("NURSE"), params("7"))
    expect(res.status).toBe(200)
    expect(downloadMock).toHaveBeenCalled()
  })

  it("VIEWER → non gaté par le consentement provider (accès à ses propres documents)", async () => {
    okDownload()
    const res = await GET(makeReq("VIEWER"), params("7"))
    expect(res.status).toBe(200)
    expect(consentMock).not.toHaveBeenCalled()
    expect(downloadMock).toHaveBeenCalled()
  })
})
