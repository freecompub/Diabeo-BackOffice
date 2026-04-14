import { SignJWT, jwtVerify, importPKCS8, importSPKI } from "jose"
import type { Role } from "@prisma/client"

const ALG = "RS256"
const TOKEN_EXPIRY = "15m" // Short-lived JWT — defense-in-depth against token theft (HR-4)
const MFA_PENDING_EXPIRY = "5m" // MFA challenge window — user must complete OTP quickly
const ISSUER = "diabeo-backoffice"
const AUDIENCE = "diabeo-hc"
const AUDIENCE_MFA = "diabeo-mfa-pending"

const VALID_ROLES: ReadonlySet<string> = new Set(["ADMIN", "DOCTOR", "NURSE", "VIEWER"])

/** Payload fields set by the application when signing a JWT */
export interface JWTSignPayload {
  sub: number
  role: Role
  platform: "hc"
  sid: string
}

/** Full payload returned after verifying a JWT (includes jose-set fields) */
export interface JWTPayload extends JWTSignPayload {
  /** Expiration timestamp (seconds since epoch) — set by jose, extracted on verify */
  exp: number
}

let cachedPrivateKey: CryptoKey | null = null
let cachedPublicKey: CryptoKey | null = null

function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, "\n")
}

async function getPrivateKey(): Promise<CryptoKey> {
  if (!cachedPrivateKey) {
    const pem = process.env.JWT_PRIVATE_KEY
    if (!pem) throw new Error("JWT_PRIVATE_KEY is not set")
    cachedPrivateKey = await importPKCS8(normalizePem(pem), ALG)
  }
  return cachedPrivateKey
}

async function getPublicKey(): Promise<CryptoKey> {
  if (!cachedPublicKey) {
    const pem = process.env.JWT_PUBLIC_KEY
    if (!pem) throw new Error("JWT_PUBLIC_KEY is not set")
    cachedPublicKey = await importSPKI(normalizePem(pem), ALG)
  }
  return cachedPublicKey
}

function validatePayload(payload: Record<string, unknown>): JWTPayload {
  const sub = Number(payload.sub)
  if (!Number.isInteger(sub) || sub <= 0) {
    throw new Error("Invalid token subject")
  }
  const role = String(payload.role)
  if (!VALID_ROLES.has(role)) {
    throw new Error("Invalid token role")
  }
  if (payload.platform !== "hc") {
    throw new Error("Invalid token platform")
  }
  if (typeof payload.sid !== "string" || !payload.sid) {
    throw new Error("Missing token session ID")
  }
  const exp = Number(payload.exp)
  if (!Number.isFinite(exp) || exp <= 0) {
    throw new Error("Missing token expiration")
  }
  return { sub, role: role as Role, platform: "hc", sid: payload.sid, exp }
}

export async function signJwt(payload: JWTSignPayload): Promise<string> {
  const key = await getPrivateKey()
  return new SignJWT({
    role: payload.role,
    platform: payload.platform,
    sid: payload.sid,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(String(payload.sub))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(key)
}

export async function verifyJwt(token: string): Promise<JWTPayload> {
  const key = await getPublicKey()
  const { payload } = await jwtVerify(token, key, {
    algorithms: [ALG],
    issuer: ISSUER,
    audience: AUDIENCE,
  })
  return validatePayload(payload)
}

/**
 * Payload for an MFA-pending token issued after successful password auth.
 * Short-lived (5 min). The client must exchange it at /api/auth/mfa/challenge
 * with a valid TOTP code to obtain a full-access JWT.
 *
 * Uses a distinct audience ("diabeo-mfa-pending") so this token is REJECTED
 * by verifyJwt() — it cannot be used to access protected routes even if stolen.
 */
export interface MfaPendingPayload {
  sub: number
  /** Discriminator field (beyond audience) — belt-and-suspenders typing. */
  type: "mfa_pending"
}

/** Sign a short-lived MFA-pending token. */
export async function signMfaPendingToken(sub: number): Promise<string> {
  const key = await getPrivateKey()
  return new SignJWT({ type: "mfa_pending" })
    .setProtectedHeader({ alg: ALG })
    .setSubject(String(sub))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE_MFA)
    .setIssuedAt()
    .setExpirationTime(MFA_PENDING_EXPIRY)
    .sign(key)
}

/**
 * Verify an MFA-pending token. Fails if audience or `type` do not match —
 * prevents using a full JWT (or a stolen mfa token) as if it were the other.
 */
export async function verifyMfaPendingToken(token: string): Promise<MfaPendingPayload> {
  const key = await getPublicKey()
  const { payload } = await jwtVerify(token, key, {
    algorithms: [ALG],
    issuer: ISSUER,
    audience: AUDIENCE_MFA,
  })
  const sub = Number(payload.sub)
  if (!Number.isInteger(sub) || sub <= 0) throw new Error("Invalid MFA token subject")
  if (payload.type !== "mfa_pending") throw new Error("Invalid MFA token type")
  return { sub, type: "mfa_pending" }
}

/** Verify JWT but allow recently expired tokens (for refresh flow, 15min grace matching TOKEN_EXPIRY) */
export async function verifyJwtAllowExpired(token: string): Promise<JWTPayload> {
  const key = await getPublicKey()
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [ALG],
      issuer: ISSUER,
      audience: AUDIENCE,
      clockTolerance: 900, // 15min grace — matches TOKEN_EXPIRY
    })
    return validatePayload(payload)
  } catch {
    throw new Error("Invalid token")
  }
}
