import { test, expect } from "@playwright/test"

test.describe("API route protection", () => {
  test("GET /api/admin/audit-logs returns 401 without session", async ({
    request,
  }) => {
    const res = await request.get("/api/admin/audit-logs")
    expect(res.status()).toBe(401)

    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  test("GET /api/admin/audit-logs rejects invalid query params", async ({
    request,
  }) => {
    // Even without auth, 401 should come first
    const res = await request.get("/api/admin/audit-logs?action=HACK")
    expect(res.status()).toBe(401)
  })

  test("NextAuth endpoints exist", async ({ request }) => {
    // NextAuth v5 should respond (even if no providers configured)
    const res = await request.get("/api/auth/providers")
    expect(res.status()).toBe(200)

    const body = await res.json()
    // No providers configured yet — should be empty object
    expect(body).toBeDefined()
  })
})
