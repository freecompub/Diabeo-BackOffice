import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { Prisma } from "@prisma/client"

/** CGM defaults per ADA guidelines */
const CGM_DEFAULTS = {
  veryLow: 0.54,
  low: 0.70,
  ok: 1.80,
  high: 2.50,
  titrLow: 0.70,
  titrHigh: 1.80,
} as const

export const objectivesService = {
  /** Get all 3 types of objectives for a patient */
  async getAll(patientId: number, auditUserId: number) {
    const [glycemia, cgm, annex] = await Promise.all([
      prisma.glycemiaObjective.findMany({
        where: { patientId, isCurrent: true },
      }),
      prisma.cgmObjective.findUnique({ where: { patientId } }),
      prisma.annexObjective.findUnique({ where: { patientId } }),
    ])

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      resourceId: `${patientId}:objectives`,
    })

    return {
      glycemia,
      cgm: cgm ?? CGM_DEFAULTS,
      annex,
    }
  },

  async updateGlycemia(
    patientId: number,
    input: Prisma.GlycemiaObjectiveUncheckedCreateInput[],
    auditUserId: number,
  ) {
    return prisma.$transaction(async (tx) => {
      // Mark old objectives as not current
      await tx.glycemiaObjective.updateMany({
        where: { patientId, isCurrent: true },
        data: { isCurrent: false },
      })

      // Create new current objectives
      const created = await Promise.all(
        input.map((obj) =>
          tx.glycemiaObjective.create({
            data: { ...obj, patientId, isCurrent: true },
          }),
        ),
      )

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${patientId}:objectives:glycemia`,
        metadata: { count: input.length },
      })

      return created
    })
  },

  async updateCgm(
    patientId: number,
    input: {
      veryLow: number
      low: number
      ok: number
      high: number
      titrLow: number
      titrHigh: number
    },
    auditUserId: number,
  ) {
    return prisma.$transaction(async (tx) => {
      const cgm = await tx.cgmObjective.upsert({
        where: { patientId },
        update: input,
        create: { patientId, ...input },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${patientId}:objectives:cgm`,
      })

      return cgm
    })
  },

  async updateAnnex(
    patientId: number,
    input: {
      objectiveHba1c?: number
      objectiveMinWeight?: number
      objectiveMaxWeight?: number
      objectiveWalk?: number
    },
    auditUserId: number,
  ) {
    return prisma.$transaction(async (tx) => {
      const annex = await tx.annexObjective.upsert({
        where: { patientId },
        update: input,
        create: { patientId, ...input },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${patientId}:objectives:annex`,
      })

      return annex
    })
  },
}
