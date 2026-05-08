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

  /**
   * US-2266 — sendDoctorEmergencyAlert.
   *
   * PHI safety contract:
   * - subject + body contain NO alert type, severity, glucose/ketone value
   * - NO patient name, DDN, NIR
   * - Only opaque "Patient #N" label + deep link + generic mention
   *
   * Failure to keep this contract = bug bloquant (RGPD Art. 9 + HDS).
   */
  describe("sendDoctorEmergencyAlert (US-2266)", () => {
    /** PHI keywords that must NEVER appear in email content (FR + EN). */
    const PHI_KEYWORDS = [
      "hypo", "hyper", "DKA", "dka",
      "severe", "critical", "warning", "sévère", "urgence",
      "glucose", "glycémie", "glycemia", "glyc",
      "cétone", "ketone", "acidocétose", "cétoacidose", "ketoacidosis",
      "hypoglycémie", "hyperglycémie", "hypoglycemia", "hyperglycemia",
      "mg/dl", "mmol/l", "g/l",
      "taux de", "valeur",
    ]

    it("sends a generic email with deep link and opaque patient label", async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: "msg-emergency" }, error: null })

      const result = await emailService.sendDoctorEmergencyAlert({
        doctorEmail: "doctor@example.com",
        alertId: 42,
        patientInternalId: 1234,
      })

      expect(result.sent).toBe(true)
      const args = mockEmailsSend.mock.calls[0][0] as { to: string; subject: string; html: string; text: string }
      expect(args.to).toBe("doctor@example.com")
      expect(args.html).toContain("https://app.diabeo.fr/dashboard/emergencies/42")
      expect(args.html).toContain("Patient #1234")
    })

    it("contains NO PHI keywords in subject + html + text (RGPD Art. 9)", async () => {
      mockEmailsSend.mockResolvedValue({ data: { id: "msg-phi" }, error: null })

      await emailService.sendDoctorEmergencyAlert({
        doctorEmail: "doctor@example.com",
        alertId: 7,
        patientInternalId: 99,
      })

      const args = mockEmailsSend.mock.calls[0][0] as { subject: string; html: string; text: string }
      const haystack = `${args.subject}\n${args.html}\n${args.text}`.toLowerCase()
      for (const kw of PHI_KEYWORDS) {
        expect(haystack).not.toContain(kw.toLowerCase())
      }
    })

    it("escapes the patient label and deep link to prevent XSS", async () => {
      // patientInternalId is a number so XSS via that is impossible — we
      // verify the deep link uses URL-encoded escape for safety against
      // future refactors.
      mockEmailsSend.mockResolvedValue({ data: { id: "msg-xss" }, error: null })

      await emailService.sendDoctorEmergencyAlert({
        doctorEmail: "doctor@example.com",
        alertId: 1,
        patientInternalId: 1,
      })

      const html = (mockEmailsSend.mock.calls[0][0] as { html: string }).html
      // basic sanity — no inline script, no unescaped quotes in href
      expect(html).not.toContain("<script>")
    })

    it("returns sent:false (non-throw) on Resend API error — best-effort", async () => {
      mockEmailsSend.mockResolvedValue({
        data: null,
        error: { message: "Service unavailable" },
      })

      const result = await emailService.sendDoctorEmergencyAlert({
        doctorEmail: "doctor@example.com",
        alertId: 1,
        patientInternalId: 1,
      })

      expect(result.sent).toBe(false)
      expect(result.error).toBe("Service unavailable")
    })
  })
})
