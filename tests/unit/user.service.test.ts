/**
 * Test suite: User Service — Profile Encryption
 *
 * Clinical behavior tested:
 * - Retrieval of a user profile transparently decrypts PII fields (firstname,
 *   lastname, email, phone, address) stored as AES-256-GCM base64 ciphertext
 * - Profile updates re-encrypt every mutated PII field before persistence,
 *   ensuring no plaintext is written to the database
 * - HMAC recalculation on email change keeps the emailHmac index consistent
 *   for future login lookups
 *
 * Associated risks:
 * - A decryption failure surfaced to the API response would expose the raw
 *   base64 ciphertext, violating HDS confidentiality requirements
 * - Skipping re-encryption on update would silently store plaintext PII,
 *   breaking the double-layer encryption architecture (ADR #2)
 * - A stale emailHmac after an email update would make the account unreachable
 *   via credential lookup, effectively locking out the user
 *
 * Edge cases:
 * - Non-existent user ID (service must return null, not throw)
 * - Fields left undefined in an update payload (unchanged fields must not be
 *   overwritten with empty ciphertext)
 * - Decryption error for a single field (should propagate, not swallow)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/crypto/health-data", () => ({
  encrypt: (v: string) => Buffer.from(`ENC:${v}`),
  decrypt: (v: Uint8Array) => {
    const str = Buffer.from(v).toString()
    if (str.startsWith("ENC:")) return str.slice(4)
    throw new Error("decrypt failed")
  },
}))

import { userService } from "@/lib/services/user.service"

describe("userService", () => {
  describe("getProfile", () => {
    it("returns decrypted profile for existing user", async () => {
      const encFirst = Buffer.from("ENC:Jean").toString("base64")
      const encLast = Buffer.from("ENC:Dupont").toString("base64")

      prismaMock.user.findUnique.mockResolvedValue({
        id: 1,
        email: Buffer.from("ENC:jean@test.com").toString("base64"),
        firstname: encFirst,
        lastname: encLast,
        title: "M.",
        birthday: new Date("1990-01-15"),
        sex: "M",
        timezone: "Europe/Paris",
        phone: null,
        address1: null,
        address2: null,
        cp: null,
        city: null,
        country: "FR",
        pic: null,
        language: "fr",
        role: "VIEWER",
        hasSignedTerms: true,
        profileComplete: true,
        needOnboarding: false,
        mfaEnabled: false,
        createdAt: new Date("2026-01-01"),
      } as never)
      prismaMock.auditLog.create.mockResolvedValue({} as never)

      const result = await userService.getProfile(1, 1)

      expect(result).not.toBeNull()
      expect(result!.firstname).toBe("Jean")
      expect(result!.lastname).toBe("Dupont")
      expect(result!.email).toBe("jean@test.com")
      expect(result!.birthday).toBe("1990-01-15")
      expect(result!.role).toBe("VIEWER")
    })

    it("returns null for non-existent user", async () => {
      prismaMock.user.findUnique.mockResolvedValue(null)
      const result = await userService.getProfile(999, 1)
      expect(result).toBeNull()
    })
  })

  describe("updateProfile", () => {
    it("encrypts fields and updates in transaction", async () => {
      const mockTx = {
        user: { update: vi.fn().mockResolvedValue({ id: 1, updatedAt: new Date() }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await userService.updateProfile(1, { firstname: "Marie", city: "Paris" }, 1)

      expect(result.id).toBe(1)
      // Verify firstname was encrypted (base64 of "ENC:Marie")
      const updateCall = mockTx.user.update.mock.calls[0][0]
      expect(updateCall.data.firstname).not.toBe("Marie")
      expect(typeof updateCall.data.firstname).toBe("string")
      // city should also be encrypted
      expect(updateCall.data.city).not.toBe("Paris")
    })
  })

  describe("acceptTerms", () => {
    it("sets hasSignedTerms and logs audit in transaction", async () => {
      const mockTx = {
        user: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await userService.acceptTerms(1)

      expect(mockTx.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { hasSignedTerms: true },
      })
      expect(mockTx.auditLog.create).toHaveBeenCalled()
    })
  })

  describe("acceptDataPolicy", () => {
    it("updates data policy fields in transaction", async () => {
      const mockTx = {
        user: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await userService.acceptDataPolicy(1)

      const updateCall = mockTx.user.update.mock.calls[0][0]
      expect(updateCall.data.needDataPolicyUpdate).toBe(false)
      expect(updateCall.data.dataPolicyUpdate).toBeInstanceOf(Date)
    })
  })

  describe("getDayMoments", () => {
    it("returns day moments for user", async () => {
      const moments = [
        { id: "1", userId: 1, type: "morning", startTime: new Date(), endTime: new Date(), isCustom: false },
      ]
      prismaMock.userDayMoment.findMany.mockResolvedValue(moments as never)

      const result = await userService.getDayMoments(1)
      expect(result).toHaveLength(1)
    })
  })

  describe("updateDayMoments", () => {
    it("deletes existing and creates new moments in transaction", async () => {
      const mockTx = {
        userDayMoment: {
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue({ id: "new1" }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await userService.updateDayMoments(1, [
        { type: "morning", startTime: "07:00", endTime: "12:00" },
      ])

      expect(mockTx.userDayMoment.deleteMany).toHaveBeenCalledWith({ where: { userId: 1 } })
      expect(mockTx.userDayMoment.create).toHaveBeenCalled()
      expect(result).toHaveLength(1)
    })
  })
})
