/**
 * @vitest-environment node
 */

/**
 * Tests: seedLocaleCookieIfAbsent — US-2112b AC-2 (cross-device, PR #513 review L3)
 *
 * Le helper est mutualisé par /api/auth/login (succès non-MFA) et
 * /api/auth/mfa/challenge (succès OTP). Il pose le cookie de locale depuis la
 * préférence enregistrée UNIQUEMENT si la requête n'en porte pas déjà un, et ne
 * l'écrase JAMAIS (la divergence est gérée par la bannière de réconciliation).
 */

import { describe, it, expect } from "vitest"
import { NextRequest, NextResponse } from "next/server"
import { seedLocaleCookieIfAbsent } from "@/i18n/seed-locale-cookie"
import { LOCALE_COOKIE } from "@/i18n/config"

function reqWith(cookieHeader?: string) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  })
}

describe("seedLocaleCookieIfAbsent", () => {
  it("seeds the cookie from the preference when the request has none", () => {
    const req = reqWith()
    const res = NextResponse.json({})
    seedLocaleCookieIfAbsent(req, res, "ar")
    const c = res.cookies.get(LOCALE_COOKIE)
    expect(c?.value).toBe("ar")
    expect(c?.httpOnly).toBe(false)
    expect(c?.sameSite).toBe("lax")
  })

  it("does NOT overwrite an existing locale cookie (divergence → banner AC-3)", () => {
    const req = reqWith(`${LOCALE_COOKIE}=fr`)
    const res = NextResponse.json({})
    seedLocaleCookieIfAbsent(req, res, "ar")
    // No cookie set on the response → the incoming fr cookie is left untouched.
    expect(res.cookies.get(LOCALE_COOKIE)).toBeUndefined()
  })

  it("does nothing when the preference is null", () => {
    const req = reqWith()
    const res = NextResponse.json({})
    seedLocaleCookieIfAbsent(req, res, null)
    expect(res.cookies.get(LOCALE_COOKIE)).toBeUndefined()
  })

  it("ignores an unsupported preference value", () => {
    const req = reqWith()
    const res = NextResponse.json({})
    seedLocaleCookieIfAbsent(req, res, "zz")
    expect(res.cookies.get(LOCALE_COOKIE)).toBeUndefined()
  })
})
