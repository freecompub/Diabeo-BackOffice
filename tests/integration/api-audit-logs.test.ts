/**
 * Integration tests for GET /api/admin/audit-logs.
 *
 * Tests the full API route handler including:
 * - Authentication (401 for unauthenticated)
 * - Authorization (403 for non-ADMIN)
 * - Zod validation of query params
 * - Successful response shape with pagination
 *
 * We mock `auth()` and `auditService` to test the HTTP layer in isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the route
// ---------------------------------------------------------------------------

// Mock NextAuth — returns session or null
const mockAuth = vi.fn()
vi.mock("@/lib/auth", () => ({
  auth: () => mockAuth(),
}))

// Mock audit service
const mockAuditLog = vi.fn().mockResolvedValue({})
const mockAuditQuery = vi.fn().mockResolvedValue({
  data: [],
  pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
})
vi.mock("@/lib/services/audit.service", () => ({
  auditService: {
    log: (...args: unknown[]) => mockAuditLog(...args),
    query: (...args: unknown[]) => mockAuditQuery(...args),
  },
  extractRequestContext: () => ({
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  }),
}))

// Import route AFTER mocks
import { GET } from "@/app/api/admin/audit-logs/route"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL("http://localhost:3000/api/admin/audit-logs")
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, val)
  }
  return new NextRequest(url, {
    method: "GET",
    headers: { "user-agent": "vitest" },
  })
}

function adminSession() {
  return {
    user: { id: "1", role: "ADMIN", name: "Admin" },
    expires: "2099-01-01",
  }
}

function doctorSession() {
  return {
    user: { id: "2", role: "DOCTOR", name: "Doctor" },
    expires: "2099-01-01",
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/admin/audit-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // =========================================================================
  // AUTH
  // =========================================================================
  describe("authentication & authorization", () => {
    it("returns 401 when not authenticated", async () => {
      mockAuth.mockResolvedValue(null)

      const res = await GET(makeRequest())

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe("Unauthorized")
    })

    it("returns 403 for non-ADMIN role", async () => {
      mockAuth.mockResolvedValue(doctorSession())

      const res = await GET(makeRequest())

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe("Forbidden")
    })

    it("logs UNAUTHORIZED audit entry for non-ADMIN access", async () => {
      mockAuth.mockResolvedValue(doctorSession())

      await GET(makeRequest())

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 2,
          action: "UNAUTHORIZED",
          resource: "SESSION",
          resourceId: "audit-logs",
        }),
      )
    })
  })

  // =========================================================================
  // VALIDATION
  // =========================================================================
  describe("query parameter validation", () => {
    it("returns 400 for invalid userId", async () => {
      mockAuth.mockResolvedValue(adminSession())

      const res = await GET(makeRequest({ userId: "abc" }))

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe("Invalid query parameters")
    })

    it("returns 400 for invalid action", async () => {
      mockAuth.mockResolvedValue(adminSession())

      const res = await GET(makeRequest({ action: "HACK" }))

      expect(res.status).toBe(400)
    })

    it("returns 400 for invalid resource", async () => {
      mockAuth.mockResolvedValue(adminSession())

      const res = await GET(makeRequest({ resource: "SECRETS" }))

      expect(res.status).toBe(400)
    })

    it("returns 400 for limit > 200", async () => {
      mockAuth.mockResolvedValue(adminSession())

      const res = await GET(makeRequest({ limit: "999" }))

      expect(res.status).toBe(400)
    })

    it("returns 400 for page = 0", async () => {
      mockAuth.mockResolvedValue(adminSession())

      const res = await GET(makeRequest({ page: "0" }))

      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // SUCCESS
  // =========================================================================
  describe("successful responses", () => {
    it("returns 200 with default pagination", async () => {
      mockAuth.mockResolvedValue(adminSession())
      mockAuditQuery.mockResolvedValue({
        data: [{ id: 1, action: "READ", resource: "PATIENT" }],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      })

      const res = await GET(makeRequest())

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(1)
      expect(body.pagination).toEqual({
        page: 1,
        limit: 50,
        total: 1,
        totalPages: 1,
      })
    })

    it("passes filters to auditService.query", async () => {
      mockAuth.mockResolvedValue(adminSession())
      mockAuditQuery.mockResolvedValue({
        data: [],
        pagination: { page: 2, limit: 25, total: 0, totalPages: 0 },
      })

      await GET(
        makeRequest({
          userId: "42",
          resource: "PATIENT",
          action: "READ",
          page: "2",
          limit: "25",
        }),
      )

      expect(mockAuditQuery).toHaveBeenCalledWith({
        userId: 42,
        resource: "PATIENT",
        action: "READ",
        from: undefined,
        to: undefined,
        page: 2,
        limit: 25,
      })
    })

    it("passes date range filters", async () => {
      mockAuth.mockResolvedValue(adminSession())
      mockAuditQuery.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      })

      await GET(
        makeRequest({
          from: "2025-01-01",
          to: "2025-12-31",
        }),
      )

      expect(mockAuditQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.any(Date),
          to: expect.any(Date),
        }),
      )
    })

    it("logs audit-of-audit for admin access", async () => {
      mockAuth.mockResolvedValue(adminSession())
      mockAuditQuery.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      })

      await GET(makeRequest({ resource: "PATIENT" }))

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          action: "READ",
          resource: "SESSION",
          resourceId: "audit-logs",
        }),
      )
    })
  })

  // =========================================================================
  // ERROR HANDLING
  // =========================================================================
  describe("error handling", () => {
    it("returns 500 when auditService.query throws", async () => {
      mockAuth.mockResolvedValue(adminSession())
      mockAuditQuery.mockRejectedValue(new Error("DB connection failed"))

      const res = await GET(makeRequest())

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe("Internal server error")
    })
  })
})
