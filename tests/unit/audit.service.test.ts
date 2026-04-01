/**
 * Unit tests for audit.service.ts.
 *
 * The audit service is central to HDS compliance — every access to patient data
 * must be logged immutably. These tests verify:
 * - Log creation with all fields
 * - Query with filters and pagination
 * - extractRequestContext correctly extracts IP and User-Agent
 */

import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import {
  auditService,
  extractRequestContext,
  type AuditLogEntry,
} from "@/lib/services/audit.service"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildAuditEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    userId: 1,
    action: "READ",
    resource: "PATIENT",
    resourceId: "42",
    ipAddress: "192.168.1.1",
    userAgent: "Mozilla/5.0",
    metadata: { detail: "test" },
    ...overrides,
  }
}

function buildAuditLogRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    action: "READ",
    resource: "PATIENT",
    resourceId: "42",
    oldValue: null,
    newValue: null,
    ipAddress: "192.168.1.1",
    userAgent: "Mozilla/5.0",
    metadata: { detail: "test" },
    createdAt: new Date("2025-06-15T10:00:00Z"),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auditService.log", () => {
  it("creates an audit log entry with all fields", async () => {
    const entry = buildAuditEntry()
    const expected = buildAuditLogRecord()
    prismaMock.auditLog.create.mockResolvedValue(expected as any)

    const result = await auditService.log(entry)

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 1,
        action: "READ",
        resource: "PATIENT",
        resourceId: "42",
        ipAddress: "192.168.1.1",
        userAgent: "Mozilla/5.0",
        metadata: { detail: "test" },
      }),
    })
    expect(result).toEqual(expected)
  })

  it("defaults optional fields to null or empty", async () => {
    const entry: AuditLogEntry = {
      userId: 2,
      action: "LOGIN",
      resource: "SESSION",
    }
    prismaMock.auditLog.create.mockResolvedValue(buildAuditLogRecord() as any)

    await auditService.log(entry)

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 2,
        action: "LOGIN",
        resource: "SESSION",
        resourceId: null,
        ipAddress: null,
        userAgent: null,
        metadata: {},
      }),
    })
  })

  it("stores oldValue and newValue for update actions", async () => {
    const entry = buildAuditEntry({
      action: "UPDATE",
      oldValue: { name: "old" },
      newValue: { name: "new" },
    })
    prismaMock.auditLog.create.mockResolvedValue(buildAuditLogRecord() as any)

    await auditService.log(entry)

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        oldValue: { name: "old" },
        newValue: { name: "new" },
      }),
    })
  })
})

describe("auditService.logWithTx", () => {
  it("creates audit log within a transaction client", async () => {
    const txMock = {
      auditLog: { create: vi.fn().mockResolvedValue(buildAuditLogRecord()) },
    }
    const entry = buildAuditEntry()

    await auditService.logWithTx(txMock as any, entry)

    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 1,
        action: "READ",
        resource: "PATIENT",
      }),
    })
  })
})

describe("auditService.getByResource", () => {
  it("queries by resource and resourceId with default limit", async () => {
    const logs = [buildAuditLogRecord()]
    prismaMock.auditLog.findMany.mockResolvedValue(logs as any)

    const result = await auditService.getByResource("PATIENT", "42")

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith({
      where: { resource: "PATIENT", resourceId: "42" },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
    expect(result).toEqual(logs)
  })

  it("respects custom limit capped at 500", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([])

    await auditService.getByResource("PATIENT", "42", 1000)

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    )
  })
})

describe("auditService.getByUser", () => {
  it("queries by userId with default limit", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([])

    await auditService.getByUser(5)

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith({
      where: { userId: 5 },
      orderBy: { createdAt: "desc" },
      take: 50,
    })
  })
})

describe("auditService.query", () => {
  it("returns paginated results with correct metadata", async () => {
    const logs = [buildAuditLogRecord()]
    prismaMock.auditLog.findMany.mockResolvedValue(logs as any)
    prismaMock.auditLog.count.mockResolvedValue(75)

    const result = await auditService.query({ page: 2, limit: 25 })

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 25,   // (page 2 - 1) * 25
        take: 25,
      }),
    )
    expect(result.pagination).toEqual({
      page: 2,
      limit: 25,
      total: 75,
      totalPages: 3,
    })
  })

  it("applies all filters correctly", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([])
    prismaMock.auditLog.count.mockResolvedValue(0)

    const from = new Date("2025-01-01")
    const to = new Date("2025-12-31")

    await auditService.query({
      userId: 3,
      resource: "PATIENT",
      action: "DELETE",
      from,
      to,
    })

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 3,
          resource: "PATIENT",
          action: "DELETE",
          createdAt: { gte: from, lte: to },
        },
      }),
    )
  })

  it("defaults to page 1, limit 50", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([])
    prismaMock.auditLog.count.mockResolvedValue(0)

    const result = await auditService.query({})

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 50,
      }),
    )
    expect(result.pagination.page).toBe(1)
    expect(result.pagination.limit).toBe(50)
  })

  it("caps limit at 200", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([])
    prismaMock.auditLog.count.mockResolvedValue(0)

    await auditService.query({ limit: 999 })

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    )
  })

  it("handles empty filter (no where clauses)", async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([])
    prismaMock.auditLog.count.mockResolvedValue(0)

    await auditService.query({})

    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      }),
    )
  })
})

describe("extractRequestContext", () => {
  it("extracts IP from x-forwarded-for header", () => {
    const req = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "203.0.113.50, 70.41.3.18",
        "user-agent": "TestBrowser/1.0",
      },
    })

    const ctx = extractRequestContext(req)

    expect(ctx.ipAddress).toBe("203.0.113.50")
    expect(ctx.userAgent).toBe("TestBrowser/1.0")
  })

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new Request("https://example.com", {
      headers: {
        "x-real-ip": "10.0.0.1",
        "user-agent": "TestBrowser/2.0",
      },
    })

    const ctx = extractRequestContext(req)

    expect(ctx.ipAddress).toBe("10.0.0.1")
  })

  it("returns 'unknown' when no IP headers present", () => {
    const req = new Request("https://example.com", {
      headers: { "user-agent": "TestBrowser/3.0" },
    })

    const ctx = extractRequestContext(req)

    expect(ctx.ipAddress).toBe("unknown")
  })

  it("returns 'unknown' when no user-agent header present", () => {
    const req = new Request("https://example.com")

    const ctx = extractRequestContext(req)

    expect(ctx.userAgent).toBe("unknown")
  })

  it("trims whitespace from x-forwarded-for first entry", () => {
    const req = new Request("https://example.com", {
      headers: {
        "x-forwarded-for": "  203.0.113.50  , 70.41.3.18",
      },
    })

    const ctx = extractRequestContext(req)

    expect(ctx.ipAddress).toBe("203.0.113.50")
  })
})
