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

export async function middleware(request: NextRequest) {
  // Skip auth routes — strip spoofed headers to prevent impersonation
  if (request.nextUrl.pathname.startsWith("/api/auth/")) {
    const headers = new Headers(request.headers)
    headers.delete("x-user-id")
    headers.delete("x-user-role")
    return NextResponse.next({ request: { headers } })
  }

  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const token = authHeader.slice(7)

  try {
    const key = await getPublicKey()
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["RS256"],
      issuer: "diabeo-backoffice",
      audience: "diabeo-hc",
    })

    // Validate sid before checking revocation
    const sid = typeof payload.sid === "string" ? payload.sid : undefined
    if (sid && isSessionRevoked(sid)) {
      return NextResponse.json({ error: "sessionRevoked" }, { status: 401 })
    }

    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("x-user-id", String(payload.sub))
    requestHeaders.set("x-user-role", String(payload.role))

    return NextResponse.next({ request: { headers: requestHeaders } })
  } catch (error) {
    const code = error instanceof Error && "code" in error
      ? (error as Error & { code: string }).code
      : undefined
    const errorKey = code === "ERR_JWT_EXPIRED" ? "tokenExpired" : "tokenInvalid"
    return NextResponse.json({ error: errorKey }, { status: 401 })
  }
}

export const config = {
  matcher: ["/api/:path*"],
}
