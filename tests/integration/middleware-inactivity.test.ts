/**
 * Tests — middleware : timeout d'inactivité (US-2621) + anti-boucle de redirection.
 *
 * Vérifie le contrat de la session glissante au niveau middleware (le slide est
 * unit-testé dans activity.test.ts ; ici on verrouille l'intégration) :
 *  - route protégée + inactivité → page : 307 /login AVEC cookie effacé (maxAge=0) ;
 *    API : 401 sessionInactivityTimeout + cookie effacé ;
 *  - anti-boucle : /login sans cookie → next() (pas de redirection) ;
 *  - /login avec token valide MAIS inactif (peek) → cookie effacé (pas de re-home).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// jose : on court-circuite la vérif crypto (clé factice + payload contrôlé).
const jwtVerify = vi.fn()
vi.mock("jose", () => ({
  jwtVerify: (...a: unknown[]) => jwtVerify(...a),
  importSPKI: vi.fn().mockResolvedValue({} as CryptoKey),
}))

const isSessionRevoked = vi.fn()
vi.mock("@/lib/auth/revocation", () => ({ isSessionRevoked: (...a: unknown[]) => isSessionRevoked(...a) }))

const slideActivity = vi.fn()
const peekActivity = vi.fn()
vi.mock("@/lib/auth/activity", () => ({
  slideActivity: (...a: unknown[]) => slideActivity(...a),
  peekActivity: (...a: unknown[]) => peekActivity(...a),
  inactivityWindowSeconds: (role: string) => (role === "VIEWER" ? null : role === "ADMIN" ? 900 : 1800),
}))

process.env.JWT_PUBLIC_KEY = "test-key"
const { middleware } = await import("@/middleware")

const PAYLOAD = { sub: 42, role: "DOCTOR", platform: "hc", sid: "sid1", av: 1 }

function reqWithCookie(path: string): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`), {
    headers: { cookie: "diabeo_token=tok" },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  jwtVerify.mockResolvedValue({ payload: PAYLOAD })
  isSessionRevoked.mockResolvedValue(false)
  slideActivity.mockResolvedValue("active")
  peekActivity.mockResolvedValue("active")
})

describe("middleware — inactivité (page protégée)", () => {
  it("inactivité → 307 /login + cookie effacé (anti-boucle)", async () => {
    slideActivity.mockResolvedValue("timedOut")
    const res = await middleware(reqWithCookie("/medecin"))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
    // Cookie effacé (maxAge=0) → la requête /login suivante n'aura plus de token.
    expect(res.headers.get("set-cookie")).toMatch(/diabeo_token=;.*[Mm]ax-[Aa]ge=0/)
  })

  it("session active → pas de coupure (slide OK, passe)", async () => {
    const res = await middleware(reqWithCookie("/medecin"))
    expect(res.status).not.toBe(307)
  })
})

describe("middleware — inactivité (route API)", () => {
  it("inactivité → 401 sessionInactivityTimeout + cookie effacé", async () => {
    slideActivity.mockResolvedValue("timedOut")
    const res = await middleware(reqWithCookie("/api/patients"))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "sessionInactivityTimeout" })
    expect(res.headers.get("set-cookie")).toMatch(/diabeo_token=;.*[Mm]ax-[Aa]ge=0/)
  })
})

describe("middleware — anti-boucle /login", () => {
  it("/login sans cookie → next() (pas de redirection)", async () => {
    const res = await middleware(new NextRequest(new URL("http://localhost/login")))
    expect(res.status).toBe(200) // NextResponse.next()
    expect(res.headers.get("location")).toBeNull()
  })

  it("/login + token valide mais inactif (peek) → cookie effacé, pas de re-home", async () => {
    peekActivity.mockResolvedValue("timedOut")
    const res = await middleware(reqWithCookie("/login"))
    // clearTokenAndContinue : next() + cookie effacé, PAS de redirect vers le home.
    expect(res.headers.get("location")).toBeNull()
    expect(res.headers.get("set-cookie")).toMatch(/diabeo_token=;.*[Mm]ax-[Aa]ge=0/)
  })

  it("/login + token valide + session active → redirige vers le home du rôle", async () => {
    const res = await middleware(reqWithCookie("/login"))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/medecin")
  })
})
