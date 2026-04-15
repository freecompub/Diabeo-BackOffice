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
import type { SecuritySchemeId } from "./spec"
import {
  loginBodySchema,
  resetPasswordBodySchema,
  mfaVerifyBodySchema,
  mfaChallengeBodySchema,
  mfaDisableBodySchema,
} from "@/lib/schemas/auth"
import {
  userProfilePatchSchema,
  privacySettingsSchema,
  privacySettingsPatchSchema,
} from "@/lib/schemas/account"

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

// Body schema is imported from src/lib/schemas/auth (single source of
// truth shared with the route handler — prevents spec drift).

const loginOkResponse = z.object({
  expiresAt: z.string(),
})

const loginMfaPendingResponse = z.object({
  mfaRequired: z.literal(true),
  mfaToken: z.string(),
})

const authRoutes: RouteDefinition[] = [
  {
    method: "POST",
    path: "/api/auth/login",
    summary: "Authenticate with email + password",
    description:
      "On success, sets an httpOnly session cookie. When MFA is enabled, " +
      "the response body contains a short-lived token to exchange at " +
      "/api/auth/mfa/challenge.",
    tags: authTags,
    body: loginBodySchema,
    responses: {
      "200": {
        description: "Auth success (cookie set) OR MFA is required",
        schema: z.union([loginOkResponse, loginMfaPendingResponse]),
      },
      "400": { description: "Validation failed", schema: ValidationError },
      "401": { description: "Invalid credentials", schema: ErrorResponse },
      "429": { description: "Rate-limited", schema: ErrorResponse },
      "503": { description: "Server error", schema: ErrorResponse },
    },
  },
  {
    method: "POST",
    path: "/api/auth/logout",
    summary: "Invalidate current session",
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
    summary: "Renew session token",
    description: "Accepts a recently expired token and issues a fresh one.",
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
    summary: "Request password reset",
    description:
      "Always returns 200 regardless of whether the email matches a user " +
      "(anti-enumeration).",
    tags: authTags,
    body: resetPasswordBodySchema,
    responses: {
      "200": { description: "Request accepted", schema: z.object({ success: z.literal(true) }) },
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
    summary: "Initiate MFA enrollment",
    description:
      "Returns an otpauth URI + QR code PNG. MFA is NOT enabled until a " +
      "first OTP is confirmed via /api/auth/mfa/verify.",
    tags: mfaTags,
    auth: ["bearerJwt", "cookieJwt"],
    responses: {
      "200": {
        description: "Secret generated — display the QR",
        schema: z.object({
          otpauthUri: z.string(),
          qrCodeDataUri: z.string(),
        }),
      },
      "401": { description: "Not authenticated", schema: ErrorResponse },
      "409": { description: "MFA is already enabled — disable it first", schema: ErrorResponse },
    },
  },
  {
    method: "POST",
    path: "/api/auth/mfa/verify",
    summary: "Confirm the first OTP and enable MFA",
    description: "Rate-limited. Only path that enables MFA.",
    tags: mfaTags,
    auth: ["bearerJwt", "cookieJwt"],
    body: mfaVerifyBodySchema,
    responses: {
      "200": {
        description: "MFA enabled",
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
    summary: "Exchange login mfaToken + OTP for a session",
    description:
      "Second leg of the login flow when MFA is enabled. The `mfaToken` " +
      "received from /api/auth/login is posted in the request body along " +
      "with the current OTP. On success, the session cookie is set.",
    tags: mfaTags,
    // Public endpoint: the short-lived token is transported in the request
    // body (NOT as an Authorization header), so no OpenAPI security scheme
    // applies. The `mfaToken` field is documented in the request body below.
    body: mfaChallengeBodySchema,
    responses: {
      "200": { description: "Session issued", schema: z.object({ expiresAt: z.string() }) },
      "400": { description: "Validation failed", schema: ValidationError },
      "401": { description: "Invalid mfaToken or invalid OTP", schema: ErrorResponse },
      "429": { description: "Rate-limited", schema: ErrorResponse },
      "503": { description: "Server error", schema: ErrorResponse },
    },
  },
  {
    method: "POST",
    path: "/api/auth/mfa/disable",
    summary: "Disable MFA — requires password + OTP",
    description:
      "Both factors are required. Uniform error on failure (no oracle on " +
      "which factor was wrong).",
    tags: mfaTags,
    auth: ["bearerJwt", "cookieJwt"],
    body: mfaDisableBodySchema,
    responses: {
      "200": {
        description: "MFA disabled",
        schema: z.object({ mfaEnabled: z.literal(false) }),
      },
      "400": { description: "MFA is not enabled on this account", schema: ErrorResponse },
      "401": { description: "Invalid password or OTP", schema: ErrorResponse },
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

const accountRoutes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/account",
    summary: "Get own account profile",
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
    body: userProfilePatchSchema,
    responses: {
      "200": { description: "Profile updated", schema: accountProfileResponse },
      "400": { description: "Validation failed", schema: ValidationError },
      "401": { description: "Not authenticated", schema: ErrorResponse },
    },
  },
  {
    method: "GET",
    path: "/api/account/privacy",
    summary: "Get privacy / sharing preferences",
    tags: accountTags,
    auth: ["bearerJwt", "cookieJwt"],
    responses: {
      "200": { description: "Privacy settings", schema: privacySettingsSchema },
      "401": { description: "Not authenticated", schema: ErrorResponse },
    },
  },
  {
    method: "PUT",
    path: "/api/account/privacy",
    summary: "Update privacy / sharing preferences",
    tags: accountTags,
    auth: ["bearerJwt", "cookieJwt"],
    body: privacySettingsPatchSchema,
    responses: {
      "200": { description: "Privacy settings updated", schema: privacySettingsSchema },
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
