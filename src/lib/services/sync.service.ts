import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"

export const syncService = {
  async pull(userId: number, deviceUid: string, clientSeqNum: bigint, auditUserId: number, ctx?: AuditContext) {
    const sync = await prisma.deviceDataSync.findUnique({
      where: { userId_deviceUid: { userId, deviceUid } },
    })

    if (!sync) throw new Error("syncNotFound")

    const safeClientSeq = BigInt(clientSeqNum)
    if (safeClientSeq < sync.sequenceNum) {
      await auditService.log({
        userId: auditUserId, action: "READ", resource: "PATIENT",
        resourceId: `sync:${deviceUid}:conflict`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
        metadata: { conflict: true, serverSeqNum: String(sync.sequenceNum), clientSeqNum: String(clientSeqNum) },
      })
      return { conflict: true, serverSeqNum: String(sync.sequenceNum), clientSeqNum: String(clientSeqNum) }
    }

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT",
      resourceId: `sync:${deviceUid}`,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
    })

    return { conflict: false, sequenceNum: String(sync.sequenceNum), lastSyncDate: sync.lastSyncDate }
  },

  async push(userId: number, deviceUid: string, _clientSeqNum: bigint, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const sync = await tx.deviceDataSync.upsert({
        where: { userId_deviceUid: { userId, deviceUid } },
        update: {
          sequenceNum: { increment: 1 },
          lastSyncDate: new Date(),
        },
        create: {
          userId, deviceUid, sequenceNum: BigInt(1), lastSyncDate: new Date(),
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "PATIENT",
        resourceId: `sync:${deviceUid}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return { success: true, sequenceNum: String(sync.sequenceNum) }
    })
  },
}
