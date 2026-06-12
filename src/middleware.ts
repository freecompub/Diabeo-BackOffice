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
 * Public endpoints — reachable without a JWT. Hoisted to module scope so the
 * Set is allocated once per process. Frozen so a test or future contributor
 * can't widen the public surface accidentally; new entries require a code
 * change visible in code review.
 */
const PUBLIC_ENDPOINTS: ReadonlySet<string> = Object.freeze(new Set([
  "/api/health",       // OVH monitoring + deployment smoke tests
  "/api/openapi.json", // OpenAPI spec for swagger-ui-cli / Postman
]))

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

  // Public endpoints (see module-level PUBLIC_ENDPOINTS). Normalize against
  // trailing slash + case so a misconfigured monitor URL doesn't fall
  // through to JWT enforcement (returning 401 as if it were an outage).
  const normalized = pathname.toLowerCase().replace(/\/+$/, "")
  if (PUBLIC_ENDPOINTS.has(normalized)) {
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

  // US-2108 — Skip cron routes (Bearer CRON_SECRET auth custom, pas JWT user).
  // Strip x-user-* spoofed headers — la route valide elle-meme via CRON_SECRET.
  if (pathname.startsWith("/api/cron/")) {
    const headers = new Headers(request.headers)
    headers.delete("x-user-id")
    headers.delete("x-user-role")
    headers.set("x-request-id", requestId)
    const res = NextResponse.next({ request: { headers } })
    res.headers.set("x-request-id", requestId)
    return res
  }

  // Auth pages — public for unauthenticated users; redirect authenticated ones to root
  // (role-router at "/" sends them to their proper dashboard).
  if (pathname === "/login" || pathname === "/reset-password") {
    const cookieToken = request.cookies.get("diabeo_token")?.value
    if (cookieToken) {
      // Token present — redirect to role-router; it'll send them to their dashboard
      // or back to /login if the token turns out to be expired/invalid.
      return NextResponse.redirect(new URL("/", request.url))
    }
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
    // US-2007 (Groupe 9) — expose session ID aux route handlers pour
    // permettre la révocation ciblée + détection "session courante".
    if (sid) requestHeaders.set("x-session-id", sid)

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

    // Fix C1 round 1 review PR #438 + Fix C2 round 1 review PR #440 —
    // Defense-in-depth ANSSI RGS §4.5 + RGPD Art. 32 + HDS Art. L.1111-8 :
    // pages patient/* + messages/* contiennent du SSR HTML avec données
    // médicales (RDV, location, motif, threads, unread counts). Sans
    // no-store, bfcache navigateur + proxy CDN/corporate peuvent retenir
    // le payload après logout sur poste partagé.
    //
    // Liste blanche PHI_PATHS — étendre ici quand de nouvelles pages PHI
    // arrivent (PR #438 patient module + PR #440 messaging).
    // #475 — `/settings` affiche des PII (nom/naissance) et, pour un patient,
    // NIRPP/INS/données médicales : même posture no-store que les autres pages.
    const PHI_PATH_PREFIXES = ["/patient/", "/messages/", "/messages", "/settings/", "/settings"]
    if (PHI_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
      res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, private")
      res.headers.set("Pragma", "no-cache")
      res.headers.set("Referrer-Policy", "no-referrer")
      res.headers.set("X-Content-Type-Options", "nosniff")
    }

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
    /** US-3356 — patient self-service layout. */
    "/patient/:path*",
    /**
     * Fix HIGH-1 round 2 review PR #426 — Pages (dashboard) groupées non
     * préfixées par `/dashboard` étaient orphelines du middleware → JWT
     * jamais vérifié, `x-user-role` jamais set, redirect(`/`) silencieux
     * pour tout user légit. Aussi : risque header-spoofing si le reverse-
     * proxy ne strip pas `x-user-*` côté client.
     *
     * Les routes ci-dessous correspondent aux dashboards rôle-spécifiques
     * (US-2400/2405/2410) + pages stub admin (#11.a) + autres pages
     * (dashboard) pré-existantes orphelines.
     */
    "/admin/:path*",
    "/medecin/:path*",
    "/infirmier/:path*",
    "/users/:path*",
    "/audit/:path*",
    "/devices/:path*",
    "/insulin-therapy/:path*",
    "/weekly/:path*",
    "/adjustment-proposals/:path*",
    "/events/:path*",
    /** US-2500-UI — Calendrier RDV pro. */
    "/appointments/:path*",
    /**
     * Fix B1 round 1 review PR #440 — US-2076-UI iter 1 messagerie pro.
     * Sans matcher, x-user-* jamais set → page redirect /login systematic.
     * Aussi : middleware pose Cache-Control no-store via fix C2 (étendu
     * de /patient/* à /messages/*).
     */
    "/messages/:path*",
  ],
}
