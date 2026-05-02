/**
 * Test suite: Email Service — Resend transactional email
 *
 * Clinical behavior tested:
 * - Password reset email sends with valid token URL
 * - Welcome email does NOT contain PII (no firstName per RGPD Art. 5.1.c)
 * - Proposal notification email uses correct action label
 * - Graceful failure on Resend API error
 * - HTML escaping prevents XSS in email templates
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockEmailsSend = vi.fn()

vi.mock("resend", () => {
  return {
    Resend: function () {
      return { emails: { send: mockEmailsSend } }
    },
  }
})

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

process.env.RESEND_API_KEY = "re_test_key"
process.env.NEXT_PUBLIC_APP_URL = "https://app.diabeo.fr"

import { emailService } from "@/lib/services/email.service"

describe("emailService", () => {
  beforeEach(() => {
    mockEmailsSend.mockReset()
  })

  describe("sendPasswordReset", () => {
    it("sends reset email with correct URL", async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: "msg-1" }, error: null })

      const result = await emailService.sendPasswordReset("test@example.com", "token-abc")

      expect(result.sent).toBe(true)
      expect(mockEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "test@example.com",
          subject: expect.stringContaining("Réinitialisation"),
          html: expect.stringContaining("https://app.diabeo.fr/reset-password/token-abc"),
        }),
      )
    })

    it("escapes HTML in reset URL", async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: "msg-2" }, error: null })

      await emailService.sendPasswordReset("test@example.com", '"><script>alert(1)</script>')

      const html = mockEmailsSend.mock.calls[0][0].html
      expect(html).not.toContain("<script>")
      expect(html).toContain("&lt;script&gt;")
    })
  })

  describe("sendWelcome", () => {
    it("does NOT contain firstName (RGPD data minimization)", async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: "msg-3" }, error: null })

      await emailService.sendWelcome("test@example.com")

      const call = mockEmailsSend.mock.calls[0][0]
      expect(call.html).toContain("Bienvenue sur Diabeo !")
      expect(call.text).not.toContain("undefined")
    })
  })

  describe("sendProposalNotification", () => {
    it("sends accepted notification", async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: "msg-4" }, error: null })

      const result = await emailService.sendProposalNotification("doc@test.com", "accepted")

      expect(result.sent).toBe(true)
      expect(mockEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining("acceptée"),
        }),
      )
    })

    it("sends rejected notification", async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: "msg-5" }, error: null })

      await emailService.sendProposalNotification("doc@test.com", "rejected")

      expect(mockEmailsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining("refusée"),
        }),
      )
    })
  })

  describe("error handling", () => {
    it("returns sent:false on Resend API error", async () => {
      mockEmailsSend.mockResolvedValue({ data: null, error: { message: "Rate limited" } })

      const result = await emailService.send({
        to: "test@test.com",
        subject: "Test",
        html: "<p>Test</p>",
      })

      expect(result.sent).toBe(false)
      expect(result.error).toBe("Rate limited")
    })

    it("returns sent:false on network error", async () => {
      mockEmailsSend.mockRejectedValue(new Error("Network timeout"))

      const result = await emailService.send({
        to: "test@test.com",
        subject: "Test",
        html: "<p>Test</p>",
      })

      expect(result.sent).toBe(false)
      expect(result.error).toBe("Network timeout")
    })
  })
})
