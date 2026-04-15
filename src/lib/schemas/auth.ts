/**
 * @module schemas/auth
 * @description Shared Zod schemas for auth routes.
 *
 * **Single source of truth**: every route handler imports its validation
 * schema from this module, and the OpenAPI registry (`src/lib/openapi/routes.ts`)
 * imports the same schemas. A change here propagates to both the runtime
 * validation and the published API contract — no drift.
 */

import { z } from "zod"

/** POST /api/auth/login body. */
export const loginBodySchema = z.object({
  email: z.email(),
  password: z.string().min(1),
})
export type LoginBody = z.infer<typeof loginBodySchema>

/** POST /api/auth/reset-password body. */
export const resetPasswordBodySchema = z.object({
  email: z.email(),
})
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>

/** 6-digit TOTP code — shared regex between /verify, /challenge, /disable. */
export const otpSchema = z.string().regex(/^\d{6}$/, "OTP must be a 6-digit code")

/** POST /api/auth/mfa/verify body. */
export const mfaVerifyBodySchema = z.object({
  otp: otpSchema,
})
export type MfaVerifyBody = z.infer<typeof mfaVerifyBodySchema>

/**
 * POST /api/auth/mfa/challenge body.
 *
 * Currently TOTP-only. When backup codes ship (see
 * docs/security/mfa-flow.md "out of scope"), this schema must become a
 * discriminated union `{ otp } | { backupCode }`.
 */
export const mfaChallengeBodySchema = z.object({
  mfaToken: z.string().min(1),
  otp: otpSchema,
})
export type MfaChallengeBody = z.infer<typeof mfaChallengeBodySchema>

/** POST /api/auth/mfa/disable body — requires both factors. */
export const mfaDisableBodySchema = z.object({
  password: z.string().min(1),
  otp: otpSchema,
})
export type MfaDisableBody = z.infer<typeof mfaDisableBodySchema>
