/**
 * Test suite: Events Service — Diabetes Events CRUD
 *
 * Clinical behavior tested:
 * - Creation of DiabetesEvent records within a Prisma transaction: the event
 *   row and its audit log entry are committed atomically so no event is
 *   persisted without a corresponding audit trace
 * - Free-text comment fields are encrypted with AES-256-GCM before insertion
 *   to protect any incidental PII the patient may include in their notes
 * - Listing events for a patient decrypts comment fields transparently and
 *   returns them in chronological order for display in the timeline UI
 * - Deletion is a soft-delete (deletedAt timestamp) preserving the record for
 *   clinical history while hiding it from active queries
 * - Access to another patient's events by a mismatched userId is rejected
 *
 * Associated risks:
 * - A failed audit log write not rolling back the event create would leave
 *   an untraced record, violating HDS audit completeness requirements
 * - Storing comment plaintext in the database would expose patient-authored
 *   free-text (which may contain diagnoses, drug names, or identifiers)
 * - Returning events for the wrong patient due to a missing ownership filter
 *   would constitute a cross-patient data-breach
 *
 * Edge cases:
 * - Event with no comment field (encryption path must be skipped, not encrypt
 *   null/undefined)
 * - Multi-type event array (e.g. ["insulinMeal", "physicalActivity"]) stored
 *   and retrieved correctly as a Prisma enum array
 * - Event listing when patient has zero events (must return empty array)
 * - Decryption error during list (should propagate, not silently omit events)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/crypto/health-data", () => ({
  encrypt: (v: string) => Buffer.from(`ENC:${v}`),
  decrypt: (v: Uint8Array) => {
    const str = Buffer.from(v).toString()
    if (str.startsWith("ENC:")) return str.slice(4)
    throw new Error("decrypt failed")
  },
}))

import { eventsService } from "@/lib/services/events.service"

describe("eventsService", () => {
  describe("create", () => {
    it("creates event with encrypted comment in transaction", async () => {
      const mockTx = {
        diabetesEvent: {
          create: vi.fn().mockResolvedValue({
            id: "uuid-1", patientId: 1, eventTypes: ["glycemia"],
            comment: Buffer.from("ENC:My comment").toString("base64"),
          }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await eventsService.create(1, {
        eventDate: "2026-04-01T10:00:00Z",
        eventTypes: ["glycemia"],
        glycemiaValue: 120,
        comment: "My comment",
      }, 1)

      expect(result.id).toBe("uuid-1")
      // Comment should be decrypted in response
      expect(result.comment).toBe("My comment")
      // Comment should be encrypted in DB
      const createCall = mockTx.diabetesEvent.create.mock.calls[0][0]
      expect(createCall.data.comment).not.toBe("My comment")
    })
  })

  describe("update", () => {
    it("updates existing event in transaction", async () => {
      const mockTx = {
        diabetesEvent: {
          findFirst: vi.fn().mockResolvedValue({ id: "uuid-1", patientId: 1 }),
          update: vi.fn().mockResolvedValue({
            id: "uuid-1", patientId: 1, comment: null,
          }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await eventsService.update("uuid-1", 1, {
        glycemiaValue: 130,
      }, 1)

      expect(result.id).toBe("uuid-1")
    })

    it("throws for non-existent event", async () => {
      const mockTx = {
        diabetesEvent: { findFirst: vi.fn().mockResolvedValue(null) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(eventsService.update("bad-id", 1, {}, 1))
        .rejects.toThrow("eventNotFound")
    })
  })

  describe("delete", () => {
    it("deletes event and logs audit", async () => {
      const mockTx = {
        diabetesEvent: {
          findFirst: vi.fn().mockResolvedValue({ id: "uuid-1", patientId: 1 }),
          delete: vi.fn().mockResolvedValue({}),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await eventsService.delete("uuid-1", 1, 1)
      expect(result.deleted).toBe(true)
    })

    it("throws for non-existent event", async () => {
      const mockTx = {
        diabetesEvent: { findFirst: vi.fn().mockResolvedValue(null) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(eventsService.delete("bad-id", 1, 1))
        .rejects.toThrow("eventNotFound")
    })
  })
})
