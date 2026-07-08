/**
 * US-2657 (slice A) — Route de pose du niveau de maturité (`PATCH /api/patients/[id]/maturity`).
 *
 * Sécurité testée : **exactement DOCTOR** (NURSE/VIEWER/ADMIN → 403 ; un patient VIEWER ne peut
 * JAMAIS s'auto-élever, AC-1), anti-IDOR (patient hors périmètre → 404), validation du niveau.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))
vi.mock("@/lib/gdpr", () => ({ requireGdprConsent: vi.fn().mockResolvedValue(true) }))
vi.mock("@/lib/access-control", () => ({ resolvePatientId: vi.fn() }))
vi.mock("@/lib/services/patient.service", () => ({
  patientService: { setMaturityLevel: vi.fn() },
}))
vi.mock("@/lib/services/audit.service", () => ({
  extractRequestContext: vi.fn().mockReturnValue({ ipAddress: "127.0.0.1", userAgent: "test" }),
}))

const { PATCH } = await import("@/app/api/patients/[id]/maturity/route")
const { resolvePatientId } = await import("@/lib/access-control")
const { patientService } = await import("@/lib/services/patient.service")

const resolve = vi.mocked(resolvePatientId)
const setLevel = vi.mocked(patientService.setMaturityLevel)

const params = (id: string) => ({ params: Promise.resolve({ id }) })
function req(role: string, body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost/api/patients/7/maturity"), {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-id": "42", "x-user-role": role },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/patients/[id]/maturity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolve.mockResolvedValue(7)
    setLevel.mockResolvedValue({ maturityLevel: "INTERMEDIATE", changed: true } as never)
  })

  it("DOCTOR pose le niveau → 200, service appelé", async () => {
    const res = await PATCH(req("DOCTOR", { level: "INTERMEDIATE" }), params("7"))
    expect(res.status).toBe(200)
    expect(setLevel).toHaveBeenCalledWith(7, "INTERMEDIATE", 42, expect.anything())
  })

  it("NURSE → 403 (ne pose pas le niveau)", async () => {
    const res = await PATCH(req("NURSE", { level: "EXPERT" }), params("7"))
    expect(res.status).toBe(403)
    expect(setLevel).not.toHaveBeenCalled()
  })

  it("VIEWER (patient) → 403 : impossible de s'auto-élever (AC-1)", async () => {
    const res = await PATCH(req("VIEWER", { level: "EXPERT" }), params("7"))
    expect(res.status).toBe(403)
    expect(setLevel).not.toHaveBeenCalled()
  })

  it("ADMIN (non-clinicien) → 403 (exactement DOCTOR)", async () => {
    const res = await PATCH(req("ADMIN", { level: "INTERMEDIATE" }), params("7"))
    expect(res.status).toBe(403)
    expect(setLevel).not.toHaveBeenCalled()
  })

  it("niveau invalide → 400", async () => {
    const res = await PATCH(req("DOCTOR", { level: "GURU" }), params("7"))
    expect(res.status).toBe(400)
    expect(setLevel).not.toHaveBeenCalled()
  })

  it("patient hors périmètre → 404 (anti-IDOR)", async () => {
    resolve.mockResolvedValue(null)
    const res = await PATCH(req("DOCTOR", { level: "EXPERT" }), params("99"))
    expect(res.status).toBe(404)
    expect(setLevel).not.toHaveBeenCalled()
  })
})
