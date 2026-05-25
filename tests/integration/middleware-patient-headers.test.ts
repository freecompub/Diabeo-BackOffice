/**
 * @description PR #438 — Fix C1 round 1 review : test que le code source du
 * middleware contient bien la logique no-store pour `/patient/*` (defense-in-
 * depth ANSSI/HDS).
 *
 * Test integration complet du middleware nécessite mocking JWT/RSA/cookies
 * complexe (cf. tests/integration/api-* qui bypass le middleware en testant
 * directement les handlers). Ce test vérifie le contrat source-level :
 *   - le middleware contient `pathname.startsWith("/patient/")`
 *   - il set Cache-Control no-store + Pragma + Referrer-Policy + X-Content-Type-Options
 *   - il n'a pas régressé entre PRs (defense forensique via grep)
 *
 * Pour test E2E complet (browser bfcache + proxy), voir tests/e2e/* (Playwright).
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const MIDDLEWARE_SOURCE = readFileSync(
  resolve(process.cwd(), "src/middleware.ts"),
  "utf-8",
)

describe("Fix C1 PR #438 — middleware /patient/* security headers (source-level)", () => {
  it("contient le branch `pathname.startsWith('/patient/')`", () => {
    expect(MIDDLEWARE_SOURCE).toMatch(/pathname\.startsWith\(\s*["']\/patient\/["']\s*\)/)
  })

  it("set Cache-Control no-store dans le branch patient", () => {
    expect(MIDDLEWARE_SOURCE).toMatch(
      /Cache-Control["']\s*,\s*["']no-store, no-cache, must-revalidate, private["']/,
    )
  })

  it("set Pragma no-cache", () => {
    expect(MIDDLEWARE_SOURCE).toMatch(/Pragma["']\s*,\s*["']no-cache["']/)
  })

  it("set Referrer-Policy no-referrer", () => {
    expect(MIDDLEWARE_SOURCE).toMatch(/Referrer-Policy["']\s*,\s*["']no-referrer["']/)
  })

  it("set X-Content-Type-Options nosniff", () => {
    expect(MIDDLEWARE_SOURCE).toMatch(/X-Content-Type-Options["']\s*,\s*["']nosniff["']/)
  })

  it("matcher inclut /patient/:path* (le middleware tourne sur les URLs patient)", () => {
    expect(MIDDLEWARE_SOURCE).toMatch(/["']\/patient\/:path\*["']/)
  })
})
