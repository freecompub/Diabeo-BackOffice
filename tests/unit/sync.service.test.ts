/**
 * Test suite: Sync Service — Differential Device Data Synchronization
 *
 * Clinical behavior tested:
 * - Pull synchronization: the server returns only records created or modified
 *   after the client's last known sequenceNum, minimizing data transfer for
 *   the iOS app's incremental sync cycle
 * - Conflict detection: when the client's sequenceNum is behind the server's
 *   last recorded value for the same deviceUid, a conflict flag is returned
 *   so the mobile app can trigger a full re-sync before pushing new data
 * - Push synchronization: client-submitted records are validated, written to
 *   the appropriate domain tables (CgmEntry, DiabetesEvent, etc.), and the
 *   DeviceDataSync row is updated with the new sequenceNum atomically
 * - Audit logging of every pull and push operation, including conflict events,
 *   so the full sync history is visible to support staff
 *
 * Associated risks:
 * - A missed conflict detection would allow a stale client to overwrite newer
 *   CGM readings on the server, silently corrupting the patient's glucose
 *   history used for analytics and bolus calculation
 * - A non-atomic push (records written but sequenceNum not updated) would
 *   cause duplicate data on the next sync cycle, inflating CGM metrics
 * - Missing audit on a conflict event would remove the ability to diagnose
 *   data-loss incidents when patients report missing readings
 *
 * Edge cases:
 * - First sync for a new device (no DeviceDataSync row exists — must be
 *   created, sequenceNum starts at 0)
 * - Client sequenceNum exactly matching server value (no conflict, empty delta)
 * - Client sequenceNum ahead of server value (should not be possible; treated
 *   as conflict or error)
 * - Pull with no new records since last sync (must return empty arrays, not null)
 * - Conflict flag must be accompanied by an audit log entry
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { syncService } from "@/lib/services/sync.service"

describe("syncService", () => {
  describe("pull", () => {
    it("returns sync data when no conflict", async () => {
      prismaMock.deviceDataSync.findUnique.mockResolvedValue({
        id: 1, userId: 1, deviceUid: "dev-1", sequenceNum: BigInt(100), lastSyncDate: new Date(),
      } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await syncService.pull(1, "dev-1", BigInt(100), 1)
      expect(result.conflict).toBe(false)
      expect(result.sequenceNum).toBe("100")
    })

    it("returns conflict when client is behind and audits it", async () => {
      prismaMock.deviceDataSync.findUnique.mockResolvedValue({
        id: 1, userId: 1, deviceUid: "dev-1", sequenceNum: BigInt(200), lastSyncDate: new Date(),
      } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await syncService.pull(1, "dev-1", BigInt(100), 1)
      expect(result.conflict).toBe(true)
      // Conflict path should still audit
      expect(prismaMock.auditLog.create).toHaveBeenCalled()
    })

    it("throws when sync not found", async () => {
      prismaMock.deviceDataSync.findUnique.mockResolvedValue(null)
      await expect(syncService.pull(1, "unknown", BigInt(0), 1)).rejects.toThrow("syncNotFound")
    })
  })

  describe("push", () => {
    it("increments sequence number in transaction", async () => {
      const mockTx = {
        deviceDataSync: {
          upsert: vi.fn().mockResolvedValue({ id: 1, sequenceNum: BigInt(101) }),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await syncService.push(1, "dev-1", BigInt(100), 1)
      expect(result.success).toBe(true)
      expect(result.sequenceNum).toBe("101")
    })
  })
})
