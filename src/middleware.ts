import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { jwtVerify, importSPKI } from "jose"

/**
 * In-memory revocation set for invalidated session IDs.
 * Populated on logout, checked on every authenticated request.
 * Entries auto-expire after 24h (JWT max lifetime).
 * TODO: Replace with Redis for multi-instance deployments.
 */
const revokedSessions = new Map<string, number>() // sid → expiry timestamp
const REVOCATION_TTL_MS = 24 * 3600_000

export function revokeSession(sid: string): void {
  revokedSessions.set(sid, Date.now() + REVOCATION_TTL_MS)
  // Cleanup old entries periodically
  if (revokedSessions.size > 1000) {
    const now = Date.now()
    for (const [key, expiry] of revokedSessions) {
      if (expiry < now) revokedSessions.delete(key)
    }
  }
}

function isSessionRevoked(sid: string): boolean {
  const expiry = revokedSessions.get(sid)
  if (!expiry) return false
  if (expiry < Date.now()) {
    revokedSessions.delete(sid)
    return false
  }
  return true
}

let cachedPublicKey: CryptoKey | null = null

async function getPublicKey(): Promise<CryptoKey> {
  if (!cachedPublicKey) {
    const pem = process.env.JWT_PUBLIC_KEY
    if (!pem) throw new Error("JWT_PUBLIC_KEY is not set")
    cachedPublicKey = await importSPKI(pem.replace(/\\n/g, "\n"), "RS256")
  }
  return cachedPublicKey
}

export async function middleware(request: NextRequest) {
  // Skip auth routes (login, reset-password don't require JWT)
  // Strip x-user-id/x-user-role to prevent header spoofing
  if (request.nextUrl.pathname.startsWith("/api/auth/")) {
    const headers = new Headers(request.headers)
    headers.delete("x-user-id")
    headers.delete("x-user-role")
    return NextResponse.next({ request: { headers } })
  }

  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const token = authHeader.slice(7)

  try {
    const key = await getPublicKey()
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["RS256"],
      issuer: "diabeo-backoffice",
      audience: "diabeo-hc",
    })

    // Check if session was revoked (logout)
    const sid = payload.sid as string | undefined
    if (sid && isSessionRevoked(sid)) {
      return NextResponse.json({ error: "Session revoked" }, { status: 401 })
    }

    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("x-user-id", String(payload.sub))
    requestHeaders.set("x-user-role", String(payload.role))

    return NextResponse.next({ request: { headers: requestHeaders } })
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401 },
    )
  }
}

export const config = {
  matcher: ["/api/:path*"],
}
