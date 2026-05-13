/**
 * Test suite: patient consent helper + decimal coercion helper
 *
 * Behaviour tested:
 * - `patientShareConsent` fails closed when `UserPrivacySettings` is absent
 *   (missing row = no consent given). RGPD Art. 7.3.
 * - `patientShareConsent` distinguishes 404 (patient not found / soft-deleted)
 *   from 403 (sharing off or consent missing).
 * - `decimalToNumber` recognises `Prisma.Decimal` instances (not duck-typing)
 *   and falls back to `Number()` for numbers / strings.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"
import { patientShareConsent } from "@/lib/consent"
import { decimalToNumber } from "@/lib/db/decimal"

beforeEach(() => {
  prismaMock.patient.findFirst.mockReset()
})

describe("patientShareConsent", () => {
  it("returns 404 when patient is missing or soft-deleted", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    const r = await patientShareConsent(99)
    expect(r).toEqual({ ok: false, status: 404, error: "patientNotFound" })
  })

  it("fails closed when privacySettings row is absent", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      userId: 7,
      user: { privacySettings: null },
    } as any)
    const r = await patientShareConsent(7)
    expect(r).toEqual({ ok: false, status: 403, error: "patientConsentMissing" })
  })

  it("blocks when gdprConsent=false", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      userId: 7,
      user: { privacySettings: { gdprConsent: false, shareWithProviders: true } },
    } as any)
    const r = await patientShareConsent(7)
    expect(r).toEqual({ ok: false, status: 403, error: "patientConsentMissing" })
  })

  it("blocks when shareWithProviders=false", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      userId: 7,
      user: { privacySettings: { gdprConsent: true, shareWithProviders: false } },
    } as any)
    const r = await patientShareConsent(7)
    expect(r).toEqual({ ok: false, status: 403, error: "sharingDisabled" })
  })

  it("allows when both flags are true", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({
      userId: 7,
      user: { privacySettings: { gdprConsent: true, shareWithProviders: true } },
    } as any)
    const r = await patientShareConsent(7)
    expect(r).toEqual({ ok: true })
  })
})

describe("decimalToNumber", () => {
  it("recognises Prisma.Decimal via instanceof", () => {
    const dec = new Prisma.Decimal("1.234567890123")
    const got = decimalToNumber(dec)
    expect(typeof got).toBe("number")
    expect(got).toBeCloseTo(1.234567890123, 6)
  })

  it("passes-through plain numbers", () => {
    expect(decimalToNumber(42)).toBe(42)
  })

  it("coerces numeric strings", () => {
    expect(decimalToNumber("3.14")).toBeCloseTo(3.14)
  })

  it("returns 0 for null/undefined", () => {
    expect(decimalToNumber(null)).toBe(0)
    expect(decimalToNumber(undefined)).toBe(0)
  })
})
