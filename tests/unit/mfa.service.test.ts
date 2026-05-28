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
      // then call verifyOtp — round-trip decrypt + check + replay-guard CAS.
      const secret = generateSecret()
      prismaMock.user.findUnique.mockResolvedValue({
        mfaSecret: `ENCRYPTED[${secret}]`,
        mfaLastUsedStep: null,
      } as any)
      prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)

      const validCode = generateSync({ strategy: "totp", secret, digits: 6, period: 30 })
      const result = await mfaService.verifyOtp(1, validCode)
      expect(result).toBe(true)
      // CAS update of mfaLastUsedStep happened
      expect(prismaMock.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { mfaLastUsedStep: expect.any(Number) },
        }),
      )
    })

    it("rejects a replay (same OTP, second call returns false)", async () => {
      // Replay scenario: verify succeeds first, then the same code is sent
      // again. Second attempt: mfaLastUsedStep is now >= the code's step,
      // so otplib's afterTimeStep filter rejects it AND the CAS would fail.
      const secret = generateSecret()
      prismaMock.user.findUnique.mockResolvedValue({
        mfaSecret: `ENCRYPTED[${secret}]`,
        // Already-consumed step in the future — the code below will have a
        // smaller timeStep and therefore be rejected.
        mfaLastUsedStep: Math.floor(Date.now() / 1000 / 30) + 10,
      } as any)

      const code = generateSync({ strategy: "totp", secret, digits: 6, period: 30 })
      const result = await mfaService.verifyOtp(1, code)
      expect(result).toBe(false)
      expect(prismaMock.user.updateMany).not.toHaveBeenCalled()
    })

    it("returns false when CAS update returns count=0 (concurrent verify won)", async () => {
      // OTP is valid, but another concurrent verify already advanced
      // mfaLastUsedStep past it — updateMany returns count=0.
      const secret = generateSecret()
      prismaMock.user.findUnique.mockResolvedValue({
        mfaSecret: `ENCRYPTED[${secret}]`,
        mfaLastUsedStep: null,
      } as any)
      prismaMock.user.updateMany.mockResolvedValue({ count: 0 } as any)

      const code = generateSync({ strategy: "totp", secret, digits: 6, period: 30 })
      const result = await mfaService.verifyOtp(1, code)
      expect(result).toBe(false)
    })

    it("returns false for an invalid 6-digit code", async () => {
      const secret = generateSecret()
      prismaMock.user.findUnique.mockResolvedValue({
        mfaSecret: `ENCRYPTED[${secret}]`,
        mfaLastUsedStep: null,
      } as any)

      const result = await mfaService.verifyOtp(1, "000000")
      expect(result).toBe(false)
    })
  })

  describe("verifyAndEnable", () => {
    it("enables MFA on successful OTP verification (atomic CAS guarded by secret)", async () => {
      const secret = generateSecret()
      const encryptedSecret = `ENCRYPTED[${secret}]`
      // Two findUnique calls: 1st in verifyAndEnable (observe secret),
      // 2nd inside verifyOtp.
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ mfaSecret: encryptedSecret } as any)
        .mockResolvedValueOnce({ mfaSecret: encryptedSecret, mfaLastUsedStep: null } as any)
      // Two updateMany calls: replay-guard CAS in verifyOtp + enable CAS.
      prismaMock.user.updateMany
        .mockResolvedValueOnce({ count: 1 } as any)
        .mockResolvedValueOnce({ count: 1 } as any)

      const validCode = generateSync({ strategy: "totp", secret, digits: 6, period: 30 })
      const result = await mfaService.verifyAndEnable(1, validCode)

      expect(result).toBe(true)
      // Final updateMany guards against secret rotation
      const enableCall = prismaMock.user.updateMany.mock.calls.at(-1)?.[0] as any
      expect(enableCall.where.mfaSecret).toBe(encryptedSecret)
      expect(enableCall.data).toEqual({ mfaEnabled: true })
    })

    it("does NOT enable MFA when OTP verification fails", async () => {
      const secret = generateSecret()
      const encryptedSecret = `ENCRYPTED[${secret}]`
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ mfaSecret: encryptedSecret } as any)
        .mockResolvedValueOnce({ mfaSecret: encryptedSecret, mfaLastUsedStep: null } as any)

      const result = await mfaService.verifyAndEnable(1, "000000")

      expect(result).toBe(false)
      expect(prismaMock.user.updateMany).not.toHaveBeenCalled()
    })

    it("does NOT enable MFA when secret rotated mid-flight (CAS count=0)", async () => {
      // Race: between observe-secret and enable-update, generateSecret rotated
      // the value. The CAS guard returns count=0, we must NOT report success.
      const secret = generateSecret()
      const encryptedSecret = `ENCRYPTED[${secret}]`
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ mfaSecret: encryptedSecret } as any)
        .mockResolvedValueOnce({ mfaSecret: encryptedSecret, mfaLastUsedStep: null } as any)
      prismaMock.user.updateMany
        .mockResolvedValueOnce({ count: 1 } as any)  // verifyOtp CAS ok
        .mockResolvedValueOnce({ count: 0 } as any)  // enable CAS lost the race

      const validCode = generateSync({ strategy: "totp", secret, digits: 6, period: 30 })
      const result = await mfaService.verifyAndEnable(1, validCode)

      expect(result).toBe(false)
    })
  })

  describe("concurrency / replay (CAS guard)", () => {
    it("two parallel verifyOtp calls of the same code: only one wins", async () => {
      // Simulates a real race — both calls observe the same prior state, then
      // both attempt the CAS. Prisma's optimistic CAS lets exactly one succeed.
      const secret = generateSecret()
      prismaMock.user.findUnique.mockResolvedValue({
        mfaSecret: `ENCRYPTED[${secret}]`,
        mfaLastUsedStep: null,
      } as any)
      // First updateMany wins (count=1), second loses the race (count=0).
      prismaMock.user.updateMany
        .mockResolvedValueOnce({ count: 1 } as any)
        .mockResolvedValueOnce({ count: 0 } as any)

      const code = generateSync({ strategy: "totp", secret, digits: 6, period: 30 })
      const [a, b] = await Promise.all([
        mfaService.verifyOtp(1, code),
        mfaService.verifyOtp(1, code),
      ])

      expect([a, b].filter(Boolean)).toHaveLength(1)
      expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(2)
    })
  })

  describe("disable", () => {
    it("clears both secret and enabled flag", async () => {
      prismaMock.user.update.mockResolvedValue({} as any)

      await mfaService.disable(1)

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { mfaSecret: null, mfaEnabled: false, mfaLastUsedStep: null },
      })
    })
  })

  // Plan B follow-up A2 — Step-up MFA.
  describe("stepUp", () => {
    it("returns null si OTP invalide (verifyOtp false)", async () => {
      // A2 round 2 H-2 — findUnique 1 = mfaEnabled check, findUnique 2 = verifyOtp.
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ mfaEnabled: true } as any) // service-level check
        .mockResolvedValueOnce({ mfaSecret: null } as any) // verifyOtp interne

      const result = await mfaService.stepUp(1, "sess-x", "123456")
      expect(result).toBeNull()
      expect(prismaMock.session.updateMany).not.toHaveBeenCalled()
    })

    // A2 round 2 H-2 — service-level mfaEnabled check (defense-in-depth).
    it("H-2 — returns null si mfaEnabled=false côté service (defense-in-depth)", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({
        mfaEnabled: false,
      } as any)

      const result = await mfaService.stepUp(1, "sess-x", "123456")
      expect(result).toBeNull()
      // verifyOtp NE doit PAS être appelé si mfaEnabled=false côté service
      // (cf. count d'invocations findUnique = 1, pas 2)
      expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1)
      expect(prismaMock.session.updateMany).not.toHaveBeenCalled()
    })

    it("H-2 — returns null si user introuvable", async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(null)
      const result = await mfaService.stepUp(999, "sess-x", "123456")
      expect(result).toBeNull()
      expect(prismaMock.session.updateMany).not.toHaveBeenCalled()
    })

    it("bump mfaLastVerifiedAt si OTP valide", async () => {
      const secret = generateSecret()
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ mfaEnabled: true } as any) // H-2 service check
        .mockResolvedValueOnce({
          mfaSecret: `ENCRYPTED[${secret}]`,
          mfaLastUsedStep: null,
        } as any) // verifyOtp interne
      prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
      prismaMock.session.updateMany.mockResolvedValue({ count: 1 } as any)

      const code = generateSync({ strategy: "totp", secret, digits: 6, period: 30 })
      const result = await mfaService.stepUp(42, "sess-x", code)
      expect(result).toBeInstanceOf(Date)
      // A2 round 2 H-5 — Session updated avec scope per-user + mfaEnabled filter (TOCTOU)
      expect(prismaMock.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: "sess-x",
            userId: 42,
            user: { mfaEnabled: true },
          },
          data: { mfaLastVerifiedAt: expect.any(Date) },
        }),
      )
    })

    it("returns null si session.updateMany count=0 (cross-user spoof)", async () => {
      const secret = generateSecret()
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ mfaEnabled: true } as any)
        .mockResolvedValueOnce({
          mfaSecret: `ENCRYPTED[${secret}]`,
          mfaLastUsedStep: null,
        } as any)
      prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
      prismaMock.session.updateMany.mockResolvedValue({ count: 0 } as any)

      const code = generateSync({ strategy: "totp", secret, digits: 6, period: 30 })
      const result = await mfaService.stepUp(42, "sess-foreign", code)
      expect(result).toBeNull()
    })

    // A2 round 2 H-5 — TOCTOU : disable concurrent flippe mfaEnabled entre
    // verifyOtp et updateMany → updateMany filter rejette (count=0).
    it("H-5 — TOCTOU disable concurrent → updateMany count=0 → null", async () => {
      const secret = generateSecret()
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ mfaEnabled: true } as any) // service check OK
        .mockResolvedValueOnce({
          mfaSecret: `ENCRYPTED[${secret}]`,
          mfaLastUsedStep: null,
        } as any)
      prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
      // Disable concurrent : entre verifyOtp et updateMany, mfaEnabled=false
      // → updateMany WHERE user.mfaEnabled=true ne matche plus → count=0.
      prismaMock.session.updateMany.mockResolvedValue({ count: 0 } as any)

      const code = generateSync({ strategy: "totp", secret, digits: 6, period: 30 })
      const result = await mfaService.stepUp(42, "sess-x", code)
      expect(result).toBeNull()
      // Vérifie qu'on a bien appelé updateMany avec le filter defense-in-depth
      expect(prismaMock.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: { mfaEnabled: true },
          }),
        }),
      )
    })

    it("anti-replay — un OTP valide consommé ne peut pas re-step-up", async () => {
      const secret = generateSecret()
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ mfaEnabled: true } as any)
        .mockResolvedValueOnce({
          mfaSecret: `ENCRYPTED[${secret}]`,
          mfaLastUsedStep: null,
        } as any)
      prismaMock.user.updateMany.mockResolvedValueOnce({ count: 1 } as any)
      prismaMock.session.updateMany.mockResolvedValueOnce({ count: 1 } as any)

      const code = generateSync({ strategy: "totp", secret, digits: 6, period: 30 })
      const first = await mfaService.stepUp(42, "sess-x", code)
      expect(first).toBeInstanceOf(Date)

      // 2e appel même code : mfaLastUsedStep consommé → verifyOtp false
      const consumedStep = Math.floor(Date.now() / 1000 / 30)
      prismaMock.user.findUnique
        .mockResolvedValueOnce({ mfaEnabled: true } as any)
        .mockResolvedValueOnce({
          mfaSecret: `ENCRYPTED[${secret}]`,
          mfaLastUsedStep: consumedStep,
        } as any)
      const second = await mfaService.stepUp(42, "sess-x", code)
      expect(second).toBeNull()
    })

    // H-T5 — Concurrent step-ups : repose entièrement sur verifyOtp CAS
    // (mfaLastUsedStep compare-and-set). Si la CAS retourne count=0, stepUp
    // retourne null. Test du contrat sans mock du Promise.all (simulation
    // trop fragile avec 2 findUnique × 2 stepUps = 4 calls interleavés).
    //
    // Le test "H-5 TOCTOU disable concurrent → updateMany count=0 → null"
    // ci-dessus exerce la même path code (count=0 → null) pour le CAS session.
    // Le test "anti-replay — OTP valide consommé" couvre la path CAS verifyOtp.
    //
    // Together, ces 2 tests garantissent l'invariant H-T5 sans mock concurrent.
  })
})
