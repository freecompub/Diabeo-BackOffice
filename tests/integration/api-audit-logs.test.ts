/**
 * Integration tests for GET /api/admin/audit-logs.
 *
 * Tests the full API route handler including:
 * - Authentication (401 for unauthenticated)
 * - Authorization (403 for non-ADMIN)
 * - Zod validation of query params
 * - Successful response shape with pagination
 *
 * Auth is handled by the middleware setting x-user-id/x-user-role headers.
 * We simulate this by passing headers directly to the route handler.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock Prisma (imported indirectly via @/lib/auth → session.ts)
vi.mock("@/lib/db/client", () => ({
  prisma: {},
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

function makeRequest(
  params: Record<string, string> = {},
  auth?: { userId: string; role: string },
): NextRequest {
  const url = new URL("http://localhost:3000/api/admin/audit-logs")
  for (const [key, val] of Object.entries(params)) {
    url.searchParams.set(key, val)
  }
  const headers: Record<string, string> = { "user-agent": "vitest" }
  if (auth) {
    headers["x-user-id"] = auth.userId
    headers["x-user-role"] = auth.role
  }
  return new NextRequest(url, { method: "GET", headers })
}

const admin = { userId: "1", role: "ADMIN" }
const doctor = { userId: "2", role: "DOCTOR" }

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
      const res = await GET(makeRequest())
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe("Unauthorized")
    })

    it("returns 403 for non-ADMIN role", async () => {
      const res = await GET(makeRequest({}, doctor))
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe("Forbidden")
    })
  })

  // =========================================================================
  // VALIDATION
  // =========================================================================
  describe("query parameter validation", () => {
    it("returns 400 for invalid userId", async () => {
      const res = await GET(makeRequest({ userId: "abc" }, admin))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe("Invalid query parameters")
    })

    it("returns 400 for invalid action", async () => {
      const res = await GET(makeRequest({ action: "HACK" }, admin))
      expect(res.status).toBe(400)
    })

    it("returns 400 for invalid resource", async () => {
      const res = await GET(makeRequest({ resource: "SECRETS" }, admin))
      expect(res.status).toBe(400)
    })

    it("returns 400 for limit > 200", async () => {
      const res = await GET(makeRequest({ limit: "999" }, admin))
      expect(res.status).toBe(400)
    })

    it("returns 400 for page = 0", async () => {
      const res = await GET(makeRequest({ page: "0" }, admin))
      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // SUCCESS
  // =========================================================================
  describe("successful responses", () => {
    it("returns 200 with default pagination", async () => {
      mockAuditQuery.mockResolvedValue({
        data: [{ id: 1, action: "READ", resource: "PATIENT" }],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      })

      const res = await GET(makeRequest({}, admin))

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
      mockAuditQuery.mockResolvedValue({
        data: [],
        pagination: { page: 2, limit: 25, total: 0, totalPages: 0 },
      })

      await GET(
        makeRequest(
          { userId: "42", resource: "PATIENT", action: "READ", page: "2", limit: "25" },
          admin,
        ),
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
      mockAuditQuery.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      })

      await GET(makeRequest({ from: "2025-01-01", to: "2025-12-31" }, admin))

      expect(mockAuditQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.any(Date),
          to: expect.any(Date),
        }),
      )
    })

    it("logs audit-of-audit for admin access", async () => {
      mockAuditQuery.mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      })

      await GET(makeRequest({ resource: "PATIENT" }, admin))

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
      mockAuditQuery.mockRejectedValue(new Error("DB connection failed"))

      const res = await GET(makeRequest({}, admin))

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error).toBe("Internal server error")
    })
  })
})
