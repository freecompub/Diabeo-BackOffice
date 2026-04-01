import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { jwtVerify, importSPKI } from "jose"

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
  if (request.nextUrl.pathname.startsWith("/api/auth/")) {
    return NextResponse.next()
  }

  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const token = authHeader.slice(7)

  try {
    const key = await getPublicKey()
    const { payload } = await jwtVerify(token, key, { algorithms: ["RS256"] })

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
