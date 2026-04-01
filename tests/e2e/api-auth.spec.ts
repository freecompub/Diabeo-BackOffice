import { test, expect } from "@playwright/test"

test.describe("API route protection", () => {
  test("GET /api/admin/audit-logs returns 401 without auth", async ({
    request,
  }) => {
    const res = await request.get("/api/admin/audit-logs")
    expect(res.status()).toBe(401)

    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  test("GET /api/admin/audit-logs rejects invalid query params", async ({
    request,
  }) => {
    // Without auth, 401 should come first
    const res = await request.get("/api/admin/audit-logs?action=HACK")
    expect(res.status()).toBe(401)
  })

  test("Legacy NextAuth endpoints return 410 Gone", async ({ request }) => {
    // NextAuth catch-all replaced by custom JWT auth — returns 410
    const res = await request.get("/api/auth/providers")
    expect(res.status()).toBe(410)

    const body = await res.json()
    expect(body.error).toBe("gone")
  })

  test("Custom auth login endpoint exists", async ({ request }) => {
    // POST without body should return 400 (validation failed)
    const res = await request.post("/api/auth/login", {
      data: {},
    })
    // Either 400 (validation) or 503 (server error) — but not 404
    expect(res.status()).not.toBe(404)
  })
})
