/**
 * @description Phase 4 — garde consentement `shareWithProviders` sur
 * `/api/documents/[id]/download` (frontière de sécu ajoutée en réponse à la
 * revue PR #546). Vérifie : PRO + opt-out → 404 (et pas de stream) ; PRO sans
 * row privacy → fail-open ; VIEWER → non gaté (accès à ses propres documents).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = {
  patient: { findFirst: vi.fn() },
  userPrivacySettings: { findUnique: vi.fn() },
}
vi.mock("@/lib/db/client", () => ({ prisma: prismaMock }))

vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn().mockResolvedValue(true) }))

vi.mock("@/lib/access-control", () => ({
  resolvePatientId: vi.fn().mockResolvedValue(42),
}))

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
  prismaMock.patient.findFirst.mockResolvedValue({ userId: 99 })
})

describe("GET /api/documents/[id]/download — garde consentement", () => {
  it("PRO + patient opt-out (shareWithProviders=false) → 404, pas de stream", async () => {
    prismaMock.userPrivacySettings.findUnique.mockResolvedValue({ shareWithProviders: false })
    const res = await GET(makeReq("DOCTOR"), params("7"))
    expect(res.status).toBe(404)
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it("PRO + pas de préférence (fail-open) → sert le document", async () => {
    prismaMock.userPrivacySettings.findUnique.mockResolvedValue(null)
    okDownload()
    const res = await GET(makeReq("NURSE"), params("7"))
    expect(res.status).toBe(200)
    expect(downloadMock).toHaveBeenCalled()
  })

  it("VIEWER → non gaté par shareWithProviders (accès à ses propres documents)", async () => {
    okDownload()
    const res = await GET(makeReq("VIEWER"), params("7"))
    expect(res.status).toBe(200)
    expect(prismaMock.userPrivacySettings.findUnique).not.toHaveBeenCalled()
    expect(downloadMock).toHaveBeenCalled()
  })
})
