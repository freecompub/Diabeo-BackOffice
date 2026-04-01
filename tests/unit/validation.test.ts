/**
 * Unit tests for Zod validation schemas.
 *
 * Tests the query parameter validation schema used by the audit-logs API route.
 * We recreate the schema here to test it in isolation from the HTTP layer.
 * If the schema in the route changes, these tests must be updated to match.
 */

import { describe, it, expect } from "vitest"
import { z } from "zod"

// ---------------------------------------------------------------------------
// Schema under test — mirrors src/app/api/admin/audit-logs/route.ts
// ---------------------------------------------------------------------------

const VALID_ACTIONS = [
  "LOGIN", "LOGOUT", "READ", "CREATE", "UPDATE", "DELETE",
  "EXPORT", "UNAUTHORIZED", "BOLUS_CALCULATED",
  "PROPOSAL_ACCEPTED", "PROPOSAL_REJECTED",
] as const

const VALID_RESOURCES = [
  "USER", "PATIENT", "CGM_ENTRY", "GLYCEMIA_ENTRY",
  "DIABETES_EVENT", "INSULIN_THERAPY", "BOLUS_LOG",
  "ADJUSTMENT_PROPOSAL", "MEDICAL_DOCUMENT", "SESSION",
] as const

const querySchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  resource: z.enum(VALID_RESOURCES).optional(),
  action: z.enum(VALID_ACTIONS).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("audit-logs querySchema", () => {
  describe("valid inputs", () => {
    it("accepts empty params (all defaults)", () => {
      const result = querySchema.safeParse({})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.page).toBe(1)
        expect(result.data.limit).toBe(50)
        expect(result.data.userId).toBeUndefined()
        expect(result.data.resource).toBeUndefined()
        expect(result.data.action).toBeUndefined()
      }
    })

    it("accepts all valid params as strings (query param simulation)", () => {
      const result = querySchema.safeParse({
        userId: "42",
        resource: "PATIENT",
        action: "READ",
        from: "2025-01-01",
        to: "2025-12-31",
        page: "3",
        limit: "100",
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.userId).toBe(42)
        expect(result.data.resource).toBe("PATIENT")
        expect(result.data.action).toBe("READ")
        expect(result.data.page).toBe(3)
        expect(result.data.limit).toBe(100)
        expect(result.data.from).toBeInstanceOf(Date)
        expect(result.data.to).toBeInstanceOf(Date)
      }
    })

    it("accepts each valid action", () => {
      for (const action of VALID_ACTIONS) {
        const result = querySchema.safeParse({ action })
        expect(result.success).toBe(true)
      }
    })

    it("accepts each valid resource", () => {
      for (const resource of VALID_RESOURCES) {
        const result = querySchema.safeParse({ resource })
        expect(result.success).toBe(true)
      }
    })

    it("coerces userId string to number", () => {
      const result = querySchema.safeParse({ userId: "7" })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.userId).toBe(7)
      }
    })

    it("coerces date strings to Date objects", () => {
      const result = querySchema.safeParse({
        from: "2025-06-15T10:00:00Z",
        to: "2025-06-16T10:00:00Z",
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.from).toBeInstanceOf(Date)
        expect(result.data.from!.toISOString()).toBe("2025-06-15T10:00:00.000Z")
      }
    })
  })

  describe("invalid inputs", () => {
    it("rejects non-numeric userId", () => {
      const result = querySchema.safeParse({ userId: "abc" })
      expect(result.success).toBe(false)
    })

    it("rejects negative userId", () => {
      const result = querySchema.safeParse({ userId: "-5" })
      expect(result.success).toBe(false)
    })

    it("rejects zero userId", () => {
      const result = querySchema.safeParse({ userId: "0" })
      expect(result.success).toBe(false)
    })

    it("rejects float userId", () => {
      const result = querySchema.safeParse({ userId: "3.5" })
      expect(result.success).toBe(false)
    })

    it("rejects invalid action", () => {
      const result = querySchema.safeParse({ action: "HACK" })
      expect(result.success).toBe(false)
    })

    it("rejects invalid resource", () => {
      const result = querySchema.safeParse({ resource: "SECRETS" })
      expect(result.success).toBe(false)
    })

    it("rejects page less than 1", () => {
      const result = querySchema.safeParse({ page: "0" })
      expect(result.success).toBe(false)
    })

    it("rejects negative page", () => {
      const result = querySchema.safeParse({ page: "-1" })
      expect(result.success).toBe(false)
    })

    it("rejects limit greater than 200", () => {
      const result = querySchema.safeParse({ limit: "201" })
      expect(result.success).toBe(false)
    })

    it("rejects limit of 0", () => {
      const result = querySchema.safeParse({ limit: "0" })
      expect(result.success).toBe(false)
    })

    it("rejects negative limit", () => {
      const result = querySchema.safeParse({ limit: "-10" })
      expect(result.success).toBe(false)
    })

    it("rejects invalid date format for from", () => {
      const result = querySchema.safeParse({ from: "not-a-date" })
      expect(result.success).toBe(false)
    })

    it("rejects case-sensitive action mismatch", () => {
      const result = querySchema.safeParse({ action: "read" })
      expect(result.success).toBe(false)
    })

    it("rejects case-sensitive resource mismatch", () => {
      const result = querySchema.safeParse({ resource: "patient" })
      expect(result.success).toBe(false)
    })
  })

  describe("boundary values", () => {
    it("accepts page = 1 (minimum)", () => {
      const result = querySchema.safeParse({ page: "1" })
      expect(result.success).toBe(true)
    })

    it("accepts limit = 1 (minimum)", () => {
      const result = querySchema.safeParse({ limit: "1" })
      expect(result.success).toBe(true)
    })

    it("accepts limit = 200 (maximum)", () => {
      const result = querySchema.safeParse({ limit: "200" })
      expect(result.success).toBe(true)
    })

    it("accepts userId = 1 (minimum positive)", () => {
      const result = querySchema.safeParse({ userId: "1" })
      expect(result.success).toBe(true)
    })

    it("accepts very large page number", () => {
      const result = querySchema.safeParse({ page: "999999" })
      expect(result.success).toBe(true)
    })
  })
})
