/**
 * Test suite: shared auth Zod schemas
 *
 * Clinical / security behavior tested:
 * - These schemas are the SINGLE SOURCE OF TRUTH for both runtime
 *   validation (route handlers) and the published API contract (OpenAPI
 *   registry). Loosening any rule here propagates everywhere — so the
 *   rules need direct test coverage.
 *
 * Associated risks:
 * - Removing `min(1)` on `password` would let empty-string credentials
 *   through; bcrypt would then compare against the dummy hash without
 *   ever flagging the empty input as malformed.
 * - Loosening the OTP regex (e.g. accepting non-digits) would let a
 *   crafted code reach otplib's verifySync, increasing the brute-force
 *   surface and producing confusing 500s on unexpected character classes.
 * - A schema change on `mfaToken` to `.optional()` would let the second-
 *   factor check be bypassed on /api/auth/mfa/challenge by simply omitting
 *   the field.
 */

import { describe, it, expect } from "vitest"
import {
  loginBodySchema,
  resetPasswordBodySchema,
  otpSchema,
  mfaVerifyBodySchema,
  mfaChallengeBodySchema,
  mfaDisableBodySchema,
} from "@/lib/schemas/auth"

describe("loginBodySchema", () => {
  it("accepts a valid email + non-empty password", () => {
    const result = loginBodySchema.safeParse({ email: "a@b.com", password: "x" })
    expect(result.success).toBe(true)
  })

  it("rejects a non-email", () => {
    const result = loginBodySchema.safeParse({ email: "not-an-email", password: "x" })
    expect(result.success).toBe(false)
  })

  it("rejects an empty password", () => {
    const result = loginBodySchema.safeParse({ email: "a@b.com", password: "" })
    expect(result.success).toBe(false)
  })

  it("rejects missing fields", () => {
    expect(loginBodySchema.safeParse({ email: "a@b.com" }).success).toBe(false)
    expect(loginBodySchema.safeParse({ password: "x" }).success).toBe(false)
  })
})

describe("resetPasswordBodySchema", () => {
  it("accepts a valid email", () => {
    expect(resetPasswordBodySchema.safeParse({ email: "a@b.com" }).success).toBe(true)
  })

  it("rejects a non-email", () => {
    expect(resetPasswordBodySchema.safeParse({ email: "nope" }).success).toBe(false)
  })
})

describe("otpSchema (TOTP — 6 digits)", () => {
  it("accepts exactly 6 digits", () => {
    expect(otpSchema.safeParse("123456").success).toBe(true)
    expect(otpSchema.safeParse("000000").success).toBe(true)
  })

  it("rejects non-digits", () => {
    expect(otpSchema.safeParse("abc123").success).toBe(false)
    expect(otpSchema.safeParse("12345a").success).toBe(false)
  })

  it("rejects wrong length (5 or 7 digits)", () => {
    expect(otpSchema.safeParse("12345").success).toBe(false)
    expect(otpSchema.safeParse("1234567").success).toBe(false)
  })

  it("rejects empty string and whitespace", () => {
    expect(otpSchema.safeParse("").success).toBe(false)
    expect(otpSchema.safeParse("      ").success).toBe(false)
  })
})

describe("mfaVerifyBodySchema", () => {
  it("requires a 6-digit otp", () => {
    expect(mfaVerifyBodySchema.safeParse({ otp: "123456" }).success).toBe(true)
    expect(mfaVerifyBodySchema.safeParse({ otp: "abc" }).success).toBe(false)
    expect(mfaVerifyBodySchema.safeParse({}).success).toBe(false)
  })
})

describe("mfaChallengeBodySchema", () => {
  it("accepts a valid mfaToken + otp", () => {
    const result = mfaChallengeBodySchema.safeParse({
      mfaToken: "header.payload.sig",
      otp: "123456",
    })
    expect(result.success).toBe(true)
  })

  it("REJECTS missing mfaToken (regression — must NEVER be optional)", () => {
    // Critical regression guard: a schema change flipping mfaToken to
    // `.optional()` would let the second-factor check be bypassed.
    const result = mfaChallengeBodySchema.safeParse({ otp: "123456" })
    expect(result.success).toBe(false)
  })

  it("REJECTS missing otp", () => {
    const result = mfaChallengeBodySchema.safeParse({ mfaToken: "x" })
    expect(result.success).toBe(false)
  })

  it("REJECTS empty mfaToken (min(1))", () => {
    const result = mfaChallengeBodySchema.safeParse({ mfaToken: "", otp: "123456" })
    expect(result.success).toBe(false)
  })
})

describe("mfaDisableBodySchema", () => {
  it("requires both password AND otp", () => {
    expect(
      mfaDisableBodySchema.safeParse({ password: "pw", otp: "123456" }).success,
    ).toBe(true)
    expect(
      mfaDisableBodySchema.safeParse({ password: "pw" }).success,
    ).toBe(false)
    expect(
      mfaDisableBodySchema.safeParse({ otp: "123456" }).success,
    ).toBe(false)
  })

  it("rejects an empty password (min(1))", () => {
    expect(
      mfaDisableBodySchema.safeParse({ password: "", otp: "123456" }).success,
    ).toBe(false)
  })
})
