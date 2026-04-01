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
