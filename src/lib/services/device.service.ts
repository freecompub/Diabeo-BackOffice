import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"
import type { DeviceCategory } from "@prisma/client"

const MAX_DEVICES = 9

export const deviceService = {
  async list(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const devices = await prisma.patientDevice.findMany({ where: { patientId } })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT",
      resourceId: `${patientId}:devices`,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
    })

    return devices
  },

  async create(
    patientId: number,
    input: {
      brand?: string; name?: string; model?: string; sn?: string
      type?: string; category?: DeviceCategory; connectionTypes?: string[]
      modelIdentifier?: string
    },
    auditUserId: number, ctx?: AuditContext,
  ) {
    const count = await prisma.patientDevice.count({ where: { patientId } })
    if (count >= MAX_DEVICES) throw new Error("maxDevicesReached")

    return prisma.$transaction(async (tx) => {
      const device = await tx.patientDevice.create({
        data: { patientId, ...input },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "PATIENT",
        resourceId: `device:${device.id}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return device
    })
  },

  async delete(deviceId: number, patientId: number, auditUserId: number, ctx?: AuditContext) {
    return prisma.$transaction(async (tx) => {
      const device = await tx.patientDevice.findFirst({ where: { id: deviceId, patientId } })
      if (!device) throw new Error("deviceNotFound")

      await tx.patientDevice.delete({ where: { id: deviceId } })

      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "PATIENT",
        resourceId: `device:${deviceId}`,
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      })

      return { deleted: true }
    })
  },

  async getSyncStatus(userId: number, auditUserId: number, ctx?: AuditContext) {
    const syncs = await prisma.deviceDataSync.findMany({ where: { userId } })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "PATIENT",
      resourceId: `${userId}:syncStatus`,
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
    })

    return syncs
  },
}
