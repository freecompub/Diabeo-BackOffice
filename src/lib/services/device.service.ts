import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./patient.service"
import type { DeviceCategory } from "@prisma/client"

const MAX_DEVICES = 9

export const deviceService = {
  async list(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const devices = await prisma.patientDevice.findMany({ where: { patientId } })

    await auditService.log({
      // US-2268 — list devices par patient.
      userId: auditUserId, action: "READ", resource: "DEVICE",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      metadata: { patientId },
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
        // US-2268 — resourceId = device.id, patientId pivot.
        userId: auditUserId, action: "CREATE", resource: "DEVICE",
        resourceId: String(device.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
        metadata: { patientId },
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
        // US-2268 — resourceId = device.id, patientId pivot.
        userId: auditUserId, action: "DELETE", resource: "DEVICE",
        resourceId: String(deviceId),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
        metadata: { patientId },
      })

      return { deleted: true }
    })
  },

  async getSyncStatus(userId: number, auditUserId: number, ctx?: AuditContext) {
    const [syncs, patient] = await Promise.all([
      prisma.deviceDataSync.findMany({ where: { userId } }),
      // US-2268 (re-review B6) — résolution userId → patientId pour pivot
      // forensics. Si l'user est un patient, getByPatient retrouvera ce sync.
      // Fallback sur targetUserId pour les users non-patients (admin/staff).
      prisma.patient.findFirst({ where: { userId, deletedAt: null }, select: { id: true } }),
    ])

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "DEVICE_SYNC",
      resourceId: String(userId),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent,
      metadata: patient
        ? { patientId: patient.id, targetUserId: userId }
        : { targetUserId: userId },
    })

    return syncs
  },
}
