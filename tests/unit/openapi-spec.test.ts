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

  it("declares the two transport security schemes (bearer + cookie)", () => {
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
    // The mfa-pending token is a body parameter, NOT a transport scheme.
    expect(doc.components.securitySchemes.mfaPending).toBeUndefined()
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

  it("MFA challenge is documented as public + body carries the mfaToken", () => {
    // Regression guard: the mfa-pending token must be a body parameter, not
    // a header/cookie security scheme. A 'simplification' that flips
    // /mfa/challenge to use bearerJwt would let a full-access JWT bypass the
    // second-factor check entirely.
    const challenge = doc.paths["/api/auth/mfa/challenge"].post
    expect(challenge.security).toBeUndefined()
    const bodySchema = challenge.requestBody?.content["application/json"]
      .schema as { properties?: Record<string, unknown> }
    expect(bodySchema.properties).toHaveProperty("mfaToken")
    expect(bodySchema.properties).toHaveProperty("otp")
  })

  // MINOR fix: contract guard — every registered schema must convert to
  // a valid JSON Schema without throwing. Catches future additions of
  // unsupported Zod features (brands, transforms, pipes).
  it("converts every registered Zod schema to JSON Schema without throwing", async () => {
    const { zodToOpenApiSchema } = await import("@/lib/openapi/spec")
    for (const route of OPENAPI_ROUTES) {
      if (route.body) expect(() => zodToOpenApiSchema(route.body!)).not.toThrow()
      if (route.query) expect(() => zodToOpenApiSchema(route.query!)).not.toThrow()
      if (route.pathParams) expect(() => zodToOpenApiSchema(route.pathParams!)).not.toThrow()
      for (const resp of Object.values(route.responses)) {
        if (resp.schema) expect(() => zodToOpenApiSchema(resp.schema!)).not.toThrow()
      }
    }
  })
})
