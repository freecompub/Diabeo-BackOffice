/**
 * @vitest-environment node
 */

/** Tests — stub email du mode dev mocké (US-2270). */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { emailService } from "@/lib/services/email.service"

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("MOCK_MODE", "")
  vi.stubEnv("RESEND_API_KEY", "")
})
afterEach(() => vi.unstubAllEnvs())

describe("emailService.send — mode dev mocké", () => {
  it("sans RESEND_API_KEY en dev → succès simulé (id mock-, aucun envoi réseau)", async () => {
    const res = await emailService.send({ to: "a@b.test", subject: "x", html: "<p>x</p>" })
    expect(res.sent).toBe(true)
    expect(res.id).toMatch(/^mock-/)
  })

  it("en production sans clé → ne stube PAS (échoue fort)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("RESEND_API_KEY", "")
    await expect(
      emailService.send({ to: "a@b.test", subject: "x", html: "<p>x</p>" }),
    ).rejects.toThrow(/RESEND_API_KEY/)
  })
})
