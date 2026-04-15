import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { jwtVerify, importSPKI } from "jose"
import { isSessionRevoked } from "@/lib/auth/revocation"

let cachedPublicKey: CryptoKey | null = null

async function getPublicKey(): Promise<CryptoKey> {
  if (!cachedPublicKey) {
    const pem = process.env.JWT_PUBLIC_KEY
    if (!pem) throw new Error("JWT_PUBLIC_KEY is not set")
    cachedPublicKey = await importSPKI(pem.replace(/\\n/g, "\n"), "RS256")
  }
  return cachedPublicKey
}

/**
 * Allow-list pattern for client-provided `x-request-id` (OWASP A09 —
 * Security Logging Failures). Rejects newlines, control chars, and oversized
 * values that would enable log injection / smuggling against grep/awk/SIEM.
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/

/**
 * Generate a cryptographically seeded correlation ID (16 hex chars, 64 bits).
 * Uses Web Crypto (Edge-compatible) instead of Math.random which is not
 * crypto-seeded and is consistent with the rest of the codebase's `crypto.*` usage.
 */
function generateRequestId(): string {
  const buf = new Uint8Array(8)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Accept the client-supplied `x-request-id` only when it matches the strict
 * allow-list. Otherwise generate a fresh one. Prevents log injection via
 * header smuggling and caps correlation-ID length.
 */
function resolveRequestId(incoming: string | null): string {
  if (incoming && REQUEST_ID_PATTERN.test(incoming)) return incoming
  return generateRequestId()
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Assign a correlation ID for every request. Client-supplied IDs are
  // accepted only when they match the strict allow-list (no newlines, no
  // control chars, ≤64 chars) — otherwise a fresh server-generated ID is used.
  const requestId = resolveRequestId(request.headers.get("x-request-id"))

  // Public health endpoint — must be reachable without a JWT so external
  // monitoring (OVH, uptime probes) and deployment smoke tests can alert.
  // Normalize: strip trailing slash + lowercase so misconfigured monitors
  // (`/api/health/`, `/API/health`) don't fall through to JWT enforcement.
  const normalized = pathname.toLowerCase().replace(/\/+$/, "")
  if (normalized === "/api/health") {
    const res = NextResponse.next({ request: { headers: request.headers } })
    res.headers.set("x-request-id", requestId)
    return res
  }

  // Skip auth routes — strip spoofed headers to prevent impersonation
  if (pathname.startsWith("/api/auth/")) {
    const headers = new Headers(request.headers)
    headers.delete("x-user-id")
    headers.delete("x-user-role")
    headers.set("x-request-id", requestId)
    const res = NextResponse.next({ request: { headers } })
    res.headers.set("x-request-id", requestId)
    return res
  }

  // Skip login page (public)
  if (pathname === "/login" || pathname === "/reset-password") {
    return NextResponse.next()
  }

  // Extract token from Authorization header (API) or cookie (browser pages)
  const authHeader = request.headers.get("authorization")
  const cookieToken = request.cookies.get("diabeo_token")?.value
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : cookieToken

  if (!token) {
    // API routes → 401 JSON; pages → redirect to login
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }
    return NextResponse.redirect(new URL("/login", request.url))
  }

  try {
    const key = await getPublicKey()
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["RS256"],
      issuer: "diabeo-backoffice",
      audience: "diabeo-hc",
    })

    // Check session revocation via Upstash Redis
    const sid = typeof payload.sid === "string" ? payload.sid : undefined
    if (sid && await isSessionRevoked(sid)) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "sessionRevoked" }, { status: 401 })
      }
      return NextResponse.redirect(new URL("/login", request.url))
    }

    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("x-user-id", String(payload.sub))
    requestHeaders.set("x-user-role", String(payload.role))
    requestHeaders.set("x-request-id", requestId)

    // C4: CSRF protection — state-changing requests must include custom header.
    // This header cannot be set by cross-origin form submissions (CORS blocks custom headers).
    // Auth routes are exempt because login uses a form submission pattern (no token yet).
    const method = request.method
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      if (!pathname.startsWith("/api/auth/")) {
        const xRequestedWith = requestHeaders.get("x-requested-with")
        if (xRequestedWith !== "XMLHttpRequest") {
          return NextResponse.json({ error: "csrfMissing" }, { status: 403 })
        }
      }
    }

    const res = NextResponse.next({ request: { headers: requestHeaders } })
    res.headers.set("x-request-id", requestId)
    return res
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? (error as Error & { code: string }).code
      : undefined
    const errorKey = code === "ERR_JWT_EXPIRED" ? "tokenExpired" : "tokenInvalid"
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: errorKey }, { status: 401 })
    }
    return NextResponse.redirect(new URL("/login", request.url))
  }
}

export const config = {
  matcher: [
    "/api/:path*",
    "/dashboard/:path*",
    "/patients/:path*",
    "/analytics/:path*",
    "/documents/:path*",
    "/medications/:path*",
    "/settings/:path*",
    "/import/:path*",
  ],
}
