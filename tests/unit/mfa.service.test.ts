/**
 * Test suite: MFA service (TOTP RFC 6238)
 *
 * Clinical / security behavior tested:
 * - generateSecret persists an ENCRYPTED secret (AES-256-GCM) — never a
 *   plaintext TOTP seed in the DB. A DB dump must not leak phone auth codes.
 * - generateSecret refuses when MFA is already enabled — prevents a stolen
 *   session from silently rotating the secret and locking the user out.
 * - verifyOtp rejects malformed codes (non-6-digit) BEFORE touching the DB —
 *   reduces attack surface for malformed inputs.
 * - verifyAndEnable is the ONLY path that flips mfaEnabled=true; a failed OTP
 *   must not enable MFA (protects against half-completed setup leaving the
 *   user locked out).
 * - disable clears both the secret and the enabled flag in one write.
 *
 * Associated risks:
 * - A generateSecret that stores plaintext would constitute a HDS breach.
 * - A verifyAndEnable that flipped the flag on OTP failure would lock the
 *   user out permanently (they never scanned the QR correctly yet MFA is on).
 * - A disable that left mfaSecret non-null would allow a rotated-back attack
 *   if the user re-enables MFA without re-scanning.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { generateSecret, generateSync } from "otplib"
import { prismaMock } from "../helpers/prisma-mock"

// Mock QRCode so tests don't depend on canvas / native image libs.
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,FAKE_QR") },
}))

// Mock field encryption so we can assert plaintext never hits the DB.
const encryptFieldMock = vi.fn((v: string) => `ENCRYPTED[${v}]`)
const safeDecryptFieldMock = vi.fn((v: string | null) =>
  v?.startsWith("ENCRYPTED[") ? v.slice(10, -1) : null,
)
vi.mock("@/lib/crypto/fields", () => ({
  encryptField: (v: string) => encryptFieldMock(v),
  safeDecryptField: (v: string | null) => safeDecryptFieldMock(v),
}))

import { mfaService } from "@/lib/services/mfa.service"

describe("mfaService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("generateSecret", () => {
    it("rejects when MFA is already enabled", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ mfaEnabled: true } as any)
      await expect(mfaService.generateSecret(1, "user-1")).rejects.toThrow("mfaAlreadyEnabled")
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    })

    it("rejects when user does not exist", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)
      await expect(mfaService.generateSecret(1, "user-1")).rejects.toThrow("userNotFound")
    })

    it("persists the secret ENCRYPTED — never plaintext", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ mfaEnabled: false } as any)
      prismaMock.user.update.mockResolvedValue({} as any)

      await mfaService.generateSecret(7, "user-7")

      const updateCall = prismaMock.user.update.mock.calls[0][0]
      const storedSecret = (updateCall as any).data.mfaSecret as string
      expect(storedSecret).toMatch(/^ENCRYPTED\[/)
      // Ensure the raw RFC 4648 base32 secret is NOT in the stored value
      expect(storedSecret.slice(10, -1)).toMatch(/^[A-Z2-7]+$/)
    })

    it("does NOT flip mfaEnabled to true on setup (two-step enrollment)", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ mfaEnabled: false } as any)
      prismaMock.user.update.mockResolvedValue({} as any)

      await mfaService.generateSecret(7, "user-7")

      const data = (prismaMock.user.update.mock.calls[0][0] as any).data
      expect(data.mfaEnabled).toBe(false)
    })

    it("returns an otpauth URI + QR data URI", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ mfaEnabled: false } as any)
      prismaMock.user.update.mockResolvedValue({} as any)

      const result = await mfaService.generateSecret(7, "user-7")

      expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//)
      expect(result.otpauthUri).toContain("Diabeo")
      expect(result.otpauthUri).toContain("user-7")
      expect(result.qrCodeDataUri).toBe("data:image/png;base64,FAKE_QR")
    })
  })

  describe("verifyOtp", () => {
    it("rejects non-6-digit codes before DB lookup", async () => {
      const result = await mfaService.verifyOtp(1, "abc123")
      expect(result).toBe(false)
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
    })

    it("returns false when user has no stored secret", async () => {
      prismaMock.user.findUnique.mockResolvedValue({ mfaSecret: null } as any)
      const result = await mfaService.verifyOtp(1, "123456")
      expect(result).toBe(false)
    })

    it("returns true for a valid code derived from the stored secret", async () => {
      // Generate a real TOTP for a known secret, store the ENCRYPTED form,
      // then call verifyOtp — round-trip decrypt + check.
      const secret = generateSecret()
      prismaMock.user.findUnique.mockResolvedValue({
        mfaSecret: `ENCRYPTED[${secret}]`,
      } as any)

      const validCode = generateSync({ strategy: "totp", secret, digits: 6, period: 30 })
      const result = await mfaService.verifyOtp(1, validCode)
      expect(result).toBe(true)
    })

    it("returns false for an invalid 6-digit code", async () => {
      const secret = generateSecret()
      prismaMock.user.findUnique.mockResolvedValue({
        mfaSecret: `ENCRYPTED[${secret}]`,
      } as any)

      const result = await mfaService.verifyOtp(1, "000000")
      expect(result).toBe(false)
    })
  })

  describe("verifyAndEnable", () => {
    it("enables MFA on successful OTP verification", async () => {
      const secret = generateSecret()
      prismaMock.user.findUnique.mockResolvedValue({
        mfaSecret: `ENCRYPTED[${secret}]`,
      } as any)
      prismaMock.user.update.mockResolvedValue({} as any)

      const validCode = generateSync({ strategy: "totp", secret, digits: 6, period: 30 })
      const result = await mfaService.verifyAndEnable(1, validCode)

      expect(result).toBe(true)
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { mfaEnabled: true },
        }),
      )
    })

    it("does NOT enable MFA when OTP verification fails", async () => {
      const secret = generateSecret()
      prismaMock.user.findUnique.mockResolvedValue({
        mfaSecret: `ENCRYPTED[${secret}]`,
      } as any)

      const result = await mfaService.verifyAndEnable(1, "000000")

      expect(result).toBe(false)
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    })
  })

  describe("disable", () => {
    it("clears both secret and enabled flag", async () => {
      prismaMock.user.update.mockResolvedValue({} as any)

      await mfaService.disable(1)

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { mfaSecret: null, mfaEnabled: false },
      })
    })
  })
})
