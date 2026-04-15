/**
 * Test suite: shared account Zod schemas
 *
 * Behavior tested:
 * - userProfilePatchSchema rules: name length, birthday format, country
 *   ISO-2, language enum, sex enum.
 * - privacySettingsSchema (full) vs privacySettingsPatchSchema (partial).
 * - patientProfilePatchSchema enum.
 *
 * Single source of truth shared with /api/account, /api/patient, and the
 * OpenAPI registry — direct coverage prevents silent loosening.
 */

import { describe, it, expect } from "vitest"
import {
  userProfilePatchSchema,
  patientProfilePatchSchema,
  privacySettingsSchema,
  privacySettingsPatchSchema,
} from "@/lib/schemas/account"

describe("userProfilePatchSchema", () => {
  it("accepts an empty patch (all fields optional)", () => {
    expect(userProfilePatchSchema.safeParse({}).success).toBe(true)
  })

  it("accepts a valid full patch", () => {
    const result = userProfilePatchSchema.safeParse({
      title: "Dr",
      firstname: "Jean",
      lastname: "Dupont",
      birthday: "1980-04-15",
      country: "FR",
      language: "fr",
      sex: "M",
      timezone: "Europe/Paris",
    })
    expect(result.success).toBe(true)
  })

  it("rejects birthday not in ISO YYYY-MM-DD", () => {
    expect(
      userProfilePatchSchema.safeParse({ birthday: "15/04/1980" }).success,
    ).toBe(false)
  })

  it("rejects country code not exactly 2 chars", () => {
    expect(userProfilePatchSchema.safeParse({ country: "FRA" }).success).toBe(false)
    expect(userProfilePatchSchema.safeParse({ country: "F" }).success).toBe(false)
  })

  it("rejects firstname > 100 chars", () => {
    expect(
      userProfilePatchSchema.safeParse({ firstname: "x".repeat(101) }).success,
    ).toBe(false)
  })

  it("rejects empty firstname (min(1))", () => {
    expect(userProfilePatchSchema.safeParse({ firstname: "" }).success).toBe(false)
  })

  it("rejects unknown sex enum value", () => {
    // Valid Prisma `Sex` values are M, F, X. Anything else must be rejected.
    expect(
      userProfilePatchSchema.safeParse({ sex: "Z" as never }).success,
    ).toBe(false)
  })
})

describe("patientProfilePatchSchema", () => {
  it("accepts a valid Pathology enum (DT1)", () => {
    expect(
      patientProfilePatchSchema.safeParse({ pathology: "DT1" }).success,
    ).toBe(true)
  })

  it("rejects an unknown pathology", () => {
    expect(
      patientProfilePatchSchema.safeParse({ pathology: "DT3" as never }).success,
    ).toBe(false)
  })
})

describe("privacySettingsSchema (full)", () => {
  it("requires all four boolean flags", () => {
    expect(
      privacySettingsSchema.safeParse({
        gdprConsent: true,
        shareWithProviders: true,
        shareWithResearchers: false,
        analyticsEnabled: true,
      }).success,
    ).toBe(true)

    // Missing one field → fails the full schema (use the patch one for partial)
    expect(
      privacySettingsSchema.safeParse({
        gdprConsent: true,
        shareWithProviders: true,
        shareWithResearchers: false,
      }).success,
    ).toBe(false)
  })

  it("rejects non-boolean values", () => {
    expect(
      privacySettingsSchema.safeParse({
        gdprConsent: "yes" as never,
        shareWithProviders: true,
        shareWithResearchers: false,
        analyticsEnabled: true,
      }).success,
    ).toBe(false)
  })
})

describe("privacySettingsPatchSchema (partial)", () => {
  it("accepts an empty patch", () => {
    expect(privacySettingsPatchSchema.safeParse({}).success).toBe(true)
  })

  it("accepts a single-field patch (gdpr revocation)", () => {
    expect(
      privacySettingsPatchSchema.safeParse({ gdprConsent: false }).success,
    ).toBe(true)
  })
})
