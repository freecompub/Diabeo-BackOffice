/**
 * Test suite: GET /api/openapi.json
 *
 * Clinical / operational behavior tested:
 * - Endpoint is public (no auth) — swagger-ui-cli / Postman / partner
 *   integrations fetch the spec without a session.
 * - Returns `application/json` with Cache-Control: no-store so dev changes
 *   to the registry surface immediately.
 * - The body is the OpenAPI document produced by `buildOpenApiDocument`.
 *
 * Associated risks:
 * - A protected /api/openapi.json would block iOS codegen and partner
 *   integration work (needs the spec to generate clients).
 */

import { describe, expect, it } from "vitest"

const { GET } = await import("@/app/api/openapi.json/route")

describe("GET /api/openapi.json", () => {
  it("returns 200 + JSON OpenAPI 3.1 document", async () => {
    const res = GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toMatch(/application\/json/)
    expect(res.headers.get("cache-control")).toBe("no-store")

    const body = await res.json()
    expect(body.openapi).toBe("3.1.0")
    expect(body.info.title).toBe("Diabeo Backoffice API")
    // Spec includes at least the starter route set
    expect(body.paths["/api/auth/login"]).toBeDefined()
    expect(body.paths["/api/health"]).toBeDefined()
  })
})
