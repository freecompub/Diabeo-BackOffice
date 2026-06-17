import { SignJWT, jwtVerify, importPKCS8, importSPKI } from "jose"
import { randomUUID } from "node:crypto"
import type { Role } from "@prisma/client"
import { JWT_ALG, JWT_ISSUER, JWT_AUDIENCE, JWT_VERIFY_OPTIONS } from "./jwt-constants"

// Aliases historiques — la source de vérité est `jwt-constants.ts`. Garder
// les noms courts ici évite de réécrire toutes les utilisations internes.
const ALG = JWT_ALG
const ISSUER = JWT_ISSUER
const AUDIENCE = JWT_AUDIENCE
const TOKEN_EXPIRY = "15m" // Short-lived JWT — defense-in-depth against token theft (HR-4)
const MFA_PENDING_EXPIRY = "5m" // MFA challenge window — user must complete OTP quickly
/**
 * US-2025 — QR invite TTL 15 min. Court par dessein : sans table de
 * consumption (single-use redeem), un attaquant qui capture le token peut
 * le rejouer durant la fenêtre TTL. 15 min force le pro à régénérer si le
 * patient ne flashe pas immédiatement, limitant la fenêtre d'attaque.
 * Quand l'endpoint /api/auth/patient-invite/redeem sera livré (V1+), on
 * pourra remonter la TTL à 24h en s'appuyant sur le `jti`-tracking.
 *
 * Source unique : `PATIENT_INVITE_EXPIRY_MS`. Le format string `"15m"`
 * exigé par jose `setExpirationTime` est dérivé pour éviter le drift.
 */
const PATIENT_INVITE_EXPIRY_MS = 15 * 60_000
const PATIENT_INVITE_EXPIRY = `${PATIENT_INVITE_EXPIRY_MS / 60_000}m`
const AUDIENCE_MFA = "diabeo-mfa-pending"
const AUDIENCE_PATIENT_INVITE = "diabeo-patient-invite"

const VALID_ROLES: ReadonlySet<string> = new Set(["ADMIN", "DOCTOR", "NURSE", "VIEWER"])

/** Payload fields set by the application when signing a JWT */
export interface JWTSignPayload {
  sub: number
  role: Role
  platform: "hc"
  sid: string
  /**
   * US-2619/F7 — Version d'authentification. Recopiée de `User.authVersion` à
   * l'émission ; comparée au refresh (Node) à la valeur en base. Un changement
   * de droits/statut **bump** `authVersion` → les tokens antérieurs sont rejetés
   * au refresh (en plus de la révocation Redis immédiate côté session).
   */
  av: number
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
  // Back-compat : un token pré-PR2 sans `av` → 0 (forcé à se réémettre au refresh,
  // car User.authVersion vaut ≥ 1).
  const avRaw = Number(payload.av)
  const av = Number.isInteger(avRaw) && avRaw >= 0 ? avRaw : 0
  return { sub, role: role as Role, platform: "hc", sid: payload.sid, av, exp }
}

export async function signJwt(payload: JWTSignPayload): Promise<string> {
  const key = await getPrivateKey()
  return new SignJWT({
    role: payload.role,
    platform: payload.platform,
    sid: payload.sid,
    av: payload.av,
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
  const { payload } = await jwtVerify(token, key, JWT_VERIFY_OPTIONS)
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

/**
 * Payload for a patient-invite token (US-2025) — single-use mobile QR.
 *
 * **Sub semantics** : `sub` carries the **PatientId** (not a User id). This
 * differs from regular auth JWTs (`sub = userId`). The redeem endpoint
 * (V1+, `/api/auth/patient-invite/redeem`) must:
 *   1. resolve the User row that owns this Patient (`Patient.userId`),
 *   2. authenticate as THAT user (mint a regular JWT with `sub = userId`),
 *   3. **never** trust this invite token as a session credential directly.
 *
 * Distinct audience (`diabeo-patient-invite`) prevents the token from being
 * accepted on `/api/*` protected routes (audience check fails).
 *
 * **Single-use enforcement** is OUT-OF-SCOPE for the issuer side. The redeem
 * endpoint MUST track consumed `jti`s in a dedicated table to prevent replay
 * within the 15-min TTL window. Tracker : US-2XXX (V1).
 */
export interface PatientInvitePayload {
  /** Patient ID being invited (the patient.id, NOT user.id). */
  sub: number
  /** Type discriminator (belt-and-suspenders against audience confusion). */
  type: "patient_invite"
  /** User-ID of the practitioner who created the invite (audit trail). */
  invitedBy: number
  /** Token JTI (jose-set) — used as single-use idempotency key. */
  jti: string
  /** Expiration timestamp (seconds since epoch). */
  exp: number
}

/**
 * Sign a short-lived single-use patient-invite token for QR code generation
 * (US-2025). The patient scans the QR on their mobile, the iOS app exchanges
 * the token at a future `/api/auth/patient-invite/redeem` endpoint to obtain
 * a regular JWT.
 */
export async function signPatientInviteToken(input: {
  patientId: number
  invitedBy: number
}): Promise<{ token: string; jti: string; expiresAt: Date }> {
  const key = await getPrivateKey()
  // Random JTI for future single-use tracking; jose's setJti accepts any string.
  const jti = randomUUID()
  const expiresAt = new Date(Date.now() + PATIENT_INVITE_EXPIRY_MS)
  const token = await new SignJWT({
    type: "patient_invite",
    invitedBy: input.invitedBy,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(String(input.patientId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE_PATIENT_INVITE)
    .setIssuedAt()
    .setJti(jti)
    .setExpirationTime(PATIENT_INVITE_EXPIRY)
    .sign(key)
  return { token, jti, expiresAt }
}

/**
 * Verify a patient-invite token. Fails if audience or `type` do not match —
 * cannot be confused with a full JWT.
 */
export async function verifyPatientInviteToken(token: string): Promise<PatientInvitePayload> {
  const key = await getPublicKey()
  const { payload } = await jwtVerify(token, key, {
    algorithms: [ALG],
    issuer: ISSUER,
    audience: AUDIENCE_PATIENT_INVITE,
  })
  const sub = Number(payload.sub)
  if (!Number.isInteger(sub) || sub <= 0) throw new Error("Invalid invite token subject")
  if (payload.type !== "patient_invite") throw new Error("Invalid invite token type")
  const invitedBy = Number(payload.invitedBy)
  if (!Number.isInteger(invitedBy) || invitedBy <= 0) throw new Error("Invalid invite token issuer")
  const jti = String(payload.jti ?? "")
  if (!jti) throw new Error("Missing invite token jti")
  const exp = Number(payload.exp)
  if (!Number.isFinite(exp) || exp <= 0) throw new Error("Missing invite token expiration")
  return { sub, type: "patient_invite", invitedBy, jti, exp }
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
