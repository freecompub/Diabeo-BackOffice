/**
 * @description Fix B1 + C2 round 1 review PR #440 — tests source-level que :
 *   - `/messages/:path*` est dans le matcher middleware (sinon x-user-*
 *     jamais set → page redirect /login systematic + risque header spoofing)
 *   - middleware pose Cache-Control no-store + Pragma + Referrer-Policy +
 *     X-Content-Type-Options sur les routes `/messages/*` (defense-in-depth
 *     ANSSI/HDS — PHI cacheable sinon dans bfcache + proxy CDN/corporate)
 *
 * Test integration complet (browser bfcache) → tests/e2e/* (Playwright).
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const MIDDLEWARE_SOURCE = readFileSync(
  resolve(process.cwd(), "src/middleware.ts"),
  "utf-8",
)

describe("Fix B1 + C2 PR #440 — middleware /messages/* coverage (source-level)", () => {
  it("B1 : matcher inclut `/messages/:path*` (sinon page inaccessible)", () => {
    expect(MIDDLEWARE_SOURCE).toMatch(/["']\/messages\/:path\*["']/)
  })

  it("C2 : pose Cache-Control no-store sur les pages PHI (patient + messages)", () => {
    // Le bloc contient un check `pathname.startsWith` qui couvre /patient/ ET /messages
    expect(MIDDLEWARE_SOURCE).toMatch(/PHI_PATH_PREFIXES/)
    expect(MIDDLEWARE_SOURCE).toMatch(/["']\/messages\/?["']/)
    expect(MIDDLEWARE_SOURCE).toMatch(/["']\/patient\/["']/)
  })

  it("C2 : set Cache-Control no-store complet pour PHI", () => {
    expect(MIDDLEWARE_SOURCE).toMatch(
      /Cache-Control["']\s*,\s*["']no-store, no-cache, must-revalidate, private["']/,
    )
  })

  it("C2 : set Referrer-Policy no-referrer", () => {
    expect(MIDDLEWARE_SOURCE).toMatch(/Referrer-Policy["']\s*,\s*["']no-referrer["']/)
  })

  it("C2 : set X-Content-Type-Options nosniff", () => {
    expect(MIDDLEWARE_SOURCE).toMatch(/X-Content-Type-Options["']\s*,\s*["']nosniff["']/)
  })
})
