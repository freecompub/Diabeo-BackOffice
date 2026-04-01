import { SignJWT, jwtVerify, importPKCS8, importSPKI } from "jose"
import type { Role } from "@prisma/client"

const ALG = "RS256"
const TOKEN_EXPIRY = "24h"

export interface JWTPayload {
  sub: number
  role: Role
  platform: "hc"
  sid: string // session ID for per-session logout
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

export async function signJwt(payload: JWTPayload): Promise<string> {
  const key = await getPrivateKey()
  return new SignJWT({
    role: payload.role,
    platform: payload.platform,
    sid: payload.sid,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(String(payload.sub))
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(key)
}

export async function verifyJwt(token: string): Promise<JWTPayload> {
  const key = await getPublicKey()
  const { payload } = await jwtVerify(token, key, { algorithms: [ALG] })
  return {
    sub: Number(payload.sub),
    role: payload.role as Role,
    platform: payload.platform as "hc",
    sid: payload.sid as string,
  }
}

/** Verify JWT but allow expired tokens (for refresh flow) */
export async function verifyJwtAllowExpired(token: string): Promise<JWTPayload> {
  const key = await getPublicKey()
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: [ALG],
      clockTolerance: 3600, // Allow 1h grace for refresh
    })
    return {
      sub: Number(payload.sub),
      role: payload.role as Role,
      platform: payload.platform as "hc",
      sid: payload.sid as string,
    }
  } catch {
    throw new Error("Invalid token")
  }
}
