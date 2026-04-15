/**
 * Test suite: OpenAPI spec builder
 *
 * Clinical / operational behavior tested:
 * - The spec is structurally valid OpenAPI 3.1 (openapi field present,
 *   info, paths, components).
 * - Every route in OPENAPI_ROUTES appears under `paths`. A future PR that
 *   forgets to register a new route will break this test.
 * - Security schemes (bearerJwt, cookieJwt, mfaPending) are declared.
 * - Routes marked as requiring auth carry a `security` block — a
 *   regression that removed the auth marker would surface as an unguarded
 *   operation in public docs.
 *
 * Associated risks:
 * - A spec that drifts from runtime validation would mislead API consumers
 *   (iOS app, partner integrations) — Zod-sourced schemas reduce drift but
 *   the route registry itself is hand-maintained; these tests guard the
 *   smallest contract surface (route presence + auth flag).
 */

import { describe, it, expect } from "vitest"
import { buildOpenApiDocument } from "@/lib/openapi/spec"
import { OPENAPI_ROUTES } from "@/lib/openapi/routes"

describe("buildOpenApiDocument", () => {
  const doc = buildOpenApiDocument(OPENAPI_ROUTES)

  it("declares OpenAPI 3.1", () => {
    expect(doc.openapi).toBe("3.1.0")
    expect(doc.info.title).toBe("Diabeo Backoffice API")
    expect(doc.info.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("lists production / staging / local servers", () => {
    const urls = doc.servers.map((s) => s.url)
    expect(urls).toContain("https://app.diabeo.fr")
    expect(urls).toContain("https://staging.diabeo.fr")
    expect(urls).toContain("http://localhost:3000")
  })

  it("declares the three security schemes (bearer, cookie, mfa-pending)", () => {
    expect(doc.components.securitySchemes.bearerJwt).toMatchObject({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
    })
    expect(doc.components.securitySchemes.cookieJwt).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "diabeo_token",
    })
    expect(doc.components.securitySchemes.mfaPending).toMatchObject({
      type: "http",
      scheme: "bearer",
    })
  })

  it("includes every route from the registry", () => {
    for (const route of OPENAPI_ROUTES) {
      const op = doc.paths[route.path]?.[route.method.toLowerCase()]
      expect(op, `Missing ${route.method} ${route.path}`).toBeDefined()
      expect(op.summary).toBe(route.summary)
    }
  })

  it("attaches `security` to authenticated routes only", () => {
    // /api/health is public; /api/account is not — assert the contract.
    const healthGet = doc.paths["/api/health"].get
    expect(healthGet.security).toBeUndefined()

    const accountGet = doc.paths["/api/account"].get
    expect(accountGet.security).toBeDefined()
    expect(accountGet.security?.length).toBeGreaterThan(0)
  })

  it("converts a body Zod schema to a JSON Schema requestBody", () => {
    const login = doc.paths["/api/auth/login"].post
    expect(login.requestBody).toBeDefined()
    expect(login.requestBody?.content["application/json"].schema).toMatchObject({
      type: "object",
      properties: expect.objectContaining({
        email: expect.any(Object),
        password: expect.any(Object),
      }),
    })
  })

  it("declares responses for every documented status code", () => {
    const login = doc.paths["/api/auth/login"].post
    expect(Object.keys(login.responses)).toEqual(
      expect.arrayContaining(["200", "400", "401", "429", "503"]),
    )
  })

  it("MFA challenge uses the mfa-pending security scheme (NOT full JWT)", () => {
    // Regression guard: if someone 'simplifies' the auth model, the mfa
    // challenge must not accept a full access JWT. The spec must reflect this.
    const challenge = doc.paths["/api/auth/mfa/challenge"].post
    const schemes = (challenge.security ?? []).flatMap((s) => Object.keys(s))
    expect(schemes).toContain("mfaPending")
    expect(schemes).not.toContain("bearerJwt")
    expect(schemes).not.toContain("cookieJwt")
  })
})
