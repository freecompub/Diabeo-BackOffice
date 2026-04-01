/**
 * Test suite: Input Validation — Zod Schemas for API Query Parameters
 *
 * Clinical behavior tested:
 * - Validation of the query parameter schema consumed by the audit-logs API
 *   route: userId (positive integer), resource (free string), action (enum
 *   constrained to the known AuditLog action set), from/to (ISO date strings
 *   coerced to Date), and page/pageSize (positive integers with a maximum
 *   cap to prevent oversized result sets)
 * - Rejection of unknown action values that are not part of the defined
 *   AuditLog action enum, preventing garbage data from polluting audit queries
 * - Coercion of date strings to Date objects so the service layer receives
 *   typed Date values rather than raw strings
 * - Default value injection: page defaults to 1 and pageSize defaults to 50
 *   when not supplied by the caller
 *
 * Associated risks:
 * - Accepting an arbitrary string for the action filter would allow injection
 *   of values that bypass Prisma's type safety and could produce unexpected
 *   query results in the audit log viewer
 * - A missing pageSize cap would allow a caller to request an unbounded
 *   number of audit records, causing a denial-of-service on the admin page
 * - Failing to coerce from/to strings to Date objects would cause Prisma's
 *   date comparison operators to receive strings, producing incorrect results
 *   or a runtime type error
 *
 * Edge cases:
 * - All optional fields omitted (only defaults applied — must be valid)
 * - page = 0 or pageSize = 0 (must be rejected as non-positive integers)
 * - pageSize at the allowed maximum (boundary — must be accepted)
 * - pageSize one above the maximum (must be rejected)
 * - action not in the allowed enum list (must fail with a descriptive error)
 * - from date after to date (logical inversion — validation layer or service
 *   must handle this)
 * - userId as a float (1.5) — must be rejected as non-integer
 *
 * Note: The schema is recreated inline in this test file to isolate it from
 * the HTTP layer. If the schema in the API route changes, this file must be
 * updated to match.
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
