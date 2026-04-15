/**
 * @module openapi/routes
 * @description Declarative OpenAPI route registry.
 *
 * Starter coverage (PR introducing OpenAPI): auth flow, MFA flow, account
 * basics, and the public /api/health endpoint. The full catalog of 60+
 * routes will be registered progressively in dedicated PRs — keeps each
 * diff reviewable instead of shipping a 3,000-line registry at once.
 *
 * Convention:
 * - Import the Zod schema used by the actual route handler when practical
 *   so the spec cannot drift from runtime validation.
 * - When the route handler defines its schema inline, lift it here as a
 *   `const` and export it so the route can import it back (follow-up).
 */

import { z, type ZodType } from "zod"
import { Pathology } from "@prisma/client"
import type { SecuritySchemeId } from "./spec"

export interface RouteResponse {
  description: string
  /** Optional Zod schema for the body. Omit for empty / streaming responses. */
  schema?: ZodType
}

export interface RouteDefinition {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  path: string
  summary: string
  description?: string
  tags?: string[]
  /** Empty / undefined = public endpoint. */
  auth?: SecuritySchemeId[]
  query?: ZodType
  pathParams?: ZodType
  body?: ZodType
  responses: Record<string, RouteResponse>
}

// ────────────────────────────────────────────────────────────────────────
// Shared response schemas (inline per-route for starter coverage; consolidate
// into `components.schemas` in a follow-up PR once patterns stabilize).
// ────────────────────────────────────────────────────────────────────────

const ErrorResponse = z.object({
  error: z.string().describe("Machine-readable error code (e.g. 'invalidCredentials')"),
})

const ValidationError = z.object({
  error: z.literal("validationFailed"),
  details: z.record(z.string(), z.array(z.string())).optional(),
})

// ────────────────────────────────────────────────────────────────────────
// Auth
// ────────────────────────────────────────────────────────────────────────

const authTags = ["Auth"]

const loginBody = z.object({
  email: z.email(),
  password: z.string().min(1),
})

const loginOkResponse = z.object({
  expiresAt: z.string().describe("ISO 8601 session expiry"),
})

const loginMfaPendingResponse = z.object({
  mfaRequired: z.literal(true),
  mfaToken: z.string().describe("Short-lived (5 min) JWT — see /api/auth/mfa/challenge"),
})

const authRoutes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/auth/login",
    summary: "Authenticate with email + password",
    description:
      "Sets an httpOnly cookie on success. If MFA is enabled on the account, " +
      "the response does NOT contain a full JWT — it returns an mfaToken that " +
      "must be exchanged at /api/auth/mfa/challenge.",
    tags: authTags,
    body: loginBody,
    responses: {
      "200": {
        description:
          "Either full auth success (cookie set) OR MFA is required (body " +
          "contains `mfaRequired: true, mfaToken`).",
        schema: z.union([loginOkResponse, loginMfaPendingResponse]),
      },
      "400": { description: "Validation failed", schema: ValidationError },
      "401": { description: "Invalid credentials", schema: ErrorResponse },
      "429": { description: "Rate-limited (too many failed attempts)", schema: ErrorResponse },
      "503": { description: "Server error during login", schema: ErrorResponse },
    },
  },
  {
    method: "POST",
    path: "/api/auth/logout",
    summary: "Invalidate current session",
    description: "Revokes the session via Redis + deletes the row. Clears the cookie.",
    tags: authTags,
    auth: ["bearerJwt", "cookieJwt"],
    responses: {
      "200": {
        description: "Logged out",
        schema: z.object({ success: z.literal(true) }),
      },
      "401": { description: "Not authenticated", schema: ErrorResponse },
    },
  },
  {
    method: "POST",
    path: "/api/auth/refresh",
    summary: "Renew JWT (15 min clock tolerance)",
    description:
      "Accepts an expired JWT up to 15 min old. Returns a fresh token if the " +
      "session is still valid and has not been revoked.",
    tags: authTags,
    auth: ["bearerJwt", "cookieJwt"],
    responses: {
      "200": { description: "New token issued", schema: z.object({ expiresAt: z.string() }) },
      "401": { description: "Token too old or session revoked", schema: ErrorResponse },
    },
  },
  {
    method: "POST",
    path: "/api/auth/reset-password",
    summary: "Request password reset (anti-enumeration)",
    description:
      "Always returns 200 regardless of whether the email matches a user — " +
      "prevents account-enumeration via this endpoint. Actual email sending " +
      "is a TODO (currently a stub).",
    tags: authTags,
    body: z.object({ email: z.email() }),
    responses: {
      "200": { description: "Request accepted (mock)", schema: z.object({ success: z.literal(true) }) },
      "400": { description: "Validation failed", schema: ValidationError },
    },
  },
]

// ────────────────────────────────────────────────────────────────────────
// MFA (TOTP RFC 6238 — see docs/security/mfa-flow.md)
// ────────────────────────────────────────────────────────────────────────

const mfaTags = ["Auth / MFA"]

const mfaRoutes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/auth/mfa/setup",
    summary: "Initiate MFA enrollment — returns QR code",
    description:
      "Generates a TOTP secret (encrypted at rest), returns an otpauth URI " +
      "and a base64 PNG data URI for QR rendering. `mfaEnabled` stays FALSE " +
      "until the first OTP is confirmed via /api/auth/mfa/verify.",
    tags: mfaTags,
    auth: ["bearerJwt", "cookieJwt"],
    responses: {
      "200": {
        description: "Secret generated — display the QR",
        schema: z.object({
          otpauthUri: z.string().describe("Standard otpauth:// URI for authenticator apps"),
          qrCodeDataUri: z.string().describe("data:image/png;base64,..."),
        }),
      },
      "401": { description: "Not authenticated", schema: ErrorResponse },
      "409": { description: "MFA is already enabled — disable it first", schema: ErrorResponse },
    },
  },
  {
    method: "POST",
    path: "/api/auth/mfa/verify",
    summary: "Confirm the first OTP — enables MFA",
    description:
      "Only path that flips `mfaEnabled=true`. Rate-limited (3 attempts then " +
      "exponential lockout). Emits MFA_ENABLED audit on success, " +
      "MFA_CHALLENGE_FAILED on failure.",
    tags: mfaTags,
    auth: ["bearerJwt", "cookieJwt"],
    body: z.object({ otp: z.string().regex(/^\d{6}$/) }),
    responses: {
      "200": {
        description: "MFA now enabled on the account",
        schema: z.object({ mfaEnabled: z.literal(true) }),
      },
      "400": { description: "Validation failed", schema: ValidationError },
      "401": { description: "Invalid OTP or not authenticated", schema: ErrorResponse },
      "429": { description: "Rate-limited", schema: ErrorResponse },
    },
  },
  {
    method: "POST",
    path: "/api/auth/mfa/challenge",
    summary: "Exchange mfa-pending token + OTP for a full JWT",
    description:
      "Second leg of the login flow when MFA is enabled. Sets the httpOnly " +
      "cookie (`diabeo_token`). Session is tagged `mfaVerified=true`.",
    tags: mfaTags,
    auth: ["mfaPending"],
    body: z.object({
      mfaToken: z.string().min(1),
      otp: z.string().regex(/^\d{6}$/),
    }),
    responses: {
      "200": { description: "Full JWT issued", schema: z.object({ expiresAt: z.string() }) },
      "400": { description: "Validation failed", schema: ValidationError },
      "401": { description: "Invalid mfa-pending token or invalid OTP", schema: ErrorResponse },
      "429": { description: "Rate-limited", schema: ErrorResponse },
      "503": { description: "Server error", schema: ErrorResponse },
    },
  },
  {
    method: "POST",
    path: "/api/auth/mfa/disable",
    summary: "Disable MFA — requires password + OTP (double factor)",
    description:
      "Uniform 401 `invalidCredentials` on failure (no oracle on which factor " +
      "failed). Clears both the secret and the enabled flag on success.",
    tags: mfaTags,
    auth: ["bearerJwt", "cookieJwt"],
    body: z.object({
      password: z.string().min(1),
      otp: z.string().regex(/^\d{6}$/),
    }),
    responses: {
      "200": {
        description: "MFA disabled",
        schema: z.object({ mfaEnabled: z.literal(false) }),
      },
      "400": { description: "MFA is not enabled on this account", schema: ErrorResponse },
      "401": { description: "Invalid password or OTP (uniform)", schema: ErrorResponse },
      "429": { description: "Rate-limited", schema: ErrorResponse },
    },
  },
]

// ────────────────────────────────────────────────────────────────────────
// Account
// ────────────────────────────────────────────────────────────────────────

const accountTags = ["Account"]

const accountProfileResponse = z.object({
  id: z.number().int(),
  email: z.email(),
  firstname: z.string().nullable(),
  lastname: z.string().nullable(),
  role: z.enum(["ADMIN", "DOCTOR", "NURSE", "VIEWER"]),
  mfaEnabled: z.boolean(),
  hasSignedTerms: z.boolean(),
  profileComplete: z.boolean(),
})

const patientProfilePatch = z.object({
  pathology: z.enum(Pathology).optional(),
})

const privacySettings = z.object({
  gdprConsent: z.boolean(),
  shareWithProviders: z.boolean(),
  shareWithResearchers: z.boolean(),
  analyticsEnabled: z.boolean(),
})

const accountRoutes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/account",
    summary: "Get own account profile",
    description: "Returns the authenticated user's decrypted profile.",
    tags: accountTags,
    auth: ["bearerJwt", "cookieJwt"],
    responses: {
      "200": { description: "User profile", schema: accountProfileResponse },
      "401": { description: "Not authenticated", schema: ErrorResponse },
    },
  },
  {
    method: "PUT",
    path: "/api/account",
    summary: "Update own profile",
    tags: accountTags,
    auth: ["bearerJwt", "cookieJwt"],
    body: patientProfilePatch,
    responses: {
      "200": { description: "Profile updated", schema: accountProfileResponse },
      "400": { description: "Validation failed", schema: ValidationError },
      "401": { description: "Not authenticated", schema: ErrorResponse },
    },
  },
  {
    method: "GET",
    path: "/api/account/privacy",
    summary: "Get GDPR / sharing preferences",
    tags: accountTags,
    auth: ["bearerJwt", "cookieJwt"],
    responses: {
      "200": { description: "Privacy settings", schema: privacySettings },
      "401": { description: "Not authenticated", schema: ErrorResponse },
    },
  },
  {
    method: "PUT",
    path: "/api/account/privacy",
    summary: "Update GDPR / sharing preferences",
    description:
      "PUT invalidates the 60-second GDPR consent cache (RGPD Art. 7(3) — " +
      "withdrawal must be as easy as giving consent).",
    tags: accountTags,
    auth: ["bearerJwt", "cookieJwt"],
    body: privacySettings.partial(),
    responses: {
      "200": { description: "Privacy settings updated", schema: privacySettings },
      "400": { description: "Validation failed", schema: ValidationError },
      "401": { description: "Not authenticated", schema: ErrorResponse },
    },
  },
]

// ────────────────────────────────────────────────────────────────────────
// Infra / monitoring
// ────────────────────────────────────────────────────────────────────────

const healthRoutes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/health",
    summary: "Liveness probe — DB + Redis",
    description:
      "Public endpoint (no auth) used by OVH Cloud Monitoring and deployment " +
      "smoke tests. 1 s timeout per subsystem; `version` is the 7-char git SHA.",
    tags: ["Monitoring"],
    responses: {
      "200": {
        description: "All systems green",
        schema: z.object({
          status: z.literal("ok"),
          db: z.literal("ok"),
          redis: z.literal("ok"),
          version: z.string(),
        }),
      },
      "503": {
        description:
          "Degraded (Redis down/disabled) or down (DB probe failed). Response " +
          "body reports which subsystem is at fault.",
        schema: z.object({
          status: z.enum(["degraded", "down"]),
          db: z.enum(["ok", "down"]),
          redis: z.enum(["ok", "down", "disabled"]),
          version: z.string(),
        }),
      },
    },
  },
]

// ────────────────────────────────────────────────────────────────────────
// Registry (exported)
// ────────────────────────────────────────────────────────────────────────

export const OPENAPI_ROUTES: RouteDefinition[] = [
  ...authRoutes,
  ...mfaRoutes,
  ...accountRoutes,
  ...healthRoutes,
]
