/**
 * @vitest-environment node
 */

/** Tests — stub email du mode dev mocké (US-2270). */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { infoMock } = vi.hoisted(() => ({ infoMock: vi.fn() }))
vi.mock("@/lib/logger", () => ({
  logger: { info: infoMock, error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

import { emailService } from "@/lib/services/email.service"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("MOCK_MODE", "")
  vi.stubEnv("RESEND_API_KEY", "")
})
afterEach(() => vi.unstubAllEnvs())

describe("emailService.send — mode dev mocké", () => {
  it("succès simulé (id mock-, aucun envoi) ET aucune PII loggée", async () => {
    const res = await emailService.send({
      to: "secret@patient.test",
      subject: "RDV cardiologie",
      html: "<p>x</p>",
    })
    expect(res.sent).toBe(true)
    expect(res.id).toBeDefined()
    expect(res.id!).toMatch(/^mock-/)

    // HDS/RGPD : ni le destinataire ni le sujet ne doivent apparaître dans les logs.
    const logged = infoMock.mock.calls.flat().map(String).join(" ")
    expect(logged).not.toContain("secret@patient.test")
    expect(logged).not.toContain("RDV cardiologie")
  })

  it("en production sans clé → ne stube PAS (échoue fort)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("RESEND_API_KEY", "")
    await expect(
      emailService.send({ to: "a@b.test", subject: "x", html: "<p>x</p>" }),
    ).rejects.toThrow(/RESEND_API_KEY/)
  })
})
