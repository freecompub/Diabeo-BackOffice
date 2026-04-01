import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

export const syncService = {
  /** Pull data since a given sequence number */
  async pull(userId: number, deviceUid: string, clientSeqNum: bigint, auditUserId: number, ctx?: AuditContext) {
    const sync = await prisma.deviceDataSync.findUnique({
      where: { userId_deviceUid: { userId, deviceUid } },
    })

    if (!sync) throw new Error("syncNotFound")

    // Conflict detection: client is behind
    if (clientSeqNum < sync.sequenceNum) {
      return { conflict: true, serverSeqNum: String(sync.sequenceNum), clientSeqNum: String(clientSeqNum) }
    }

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "SESSION",
      resourceId: `sync:${deviceUid}`,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
    })

    return { conflict: false, sequenceNum: String(sync.sequenceNum), lastSyncDate: sync.lastSyncDate }
  },

  /** Push new data and increment sequence number */
  async push(userId: number, deviceUid: string, clientSeqNum: bigint, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const sync = await tx.deviceDataSync.upsert({
        where: { userId_deviceUid: { userId, deviceUid } },
        update: {
          sequenceNum: { increment: 1 },
          lastSyncDate: new Date(),
        },
        create: {
          userId, deviceUid, sequenceNum: clientSeqNum + BigInt(1), lastSyncDate: new Date(),
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "SESSION",
        resourceId: `sync:${deviceUid}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return { success: true, sequenceNum: String(sync.sequenceNum) }
    })
  },
}
