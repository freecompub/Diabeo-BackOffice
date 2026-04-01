import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { Pathology, Prisma } from "@prisma/client"

/** CGM threshold shape — compatible with CgmObjective Decimal fields (as numbers for defaults) */
interface CgmThresholds {
  veryLow: number
  low: number
  ok: number
  high: number
  titrLow: number
  titrHigh: number
}

/** CGM defaults per ADA/EASD consensus — DT1/DT2 */
const CGM_DEFAULTS: CgmThresholds = {
  veryLow: 0.54,
  low: 0.70,
  ok: 1.80,
  high: 2.50,
  titrLow: 0.70,
  titrHigh: 1.80,
}

/** Tighter CGM defaults for gestational diabetes (ADA/ACOG) */
const CGM_DEFAULTS_GD: CgmThresholds = {
  veryLow: 0.54,
  low: 0.63,
  ok: 1.40,
  high: 2.00,
  titrLow: 0.63,
  titrHigh: 1.40,
}

/** Get pathology-aware CGM defaults */
export function getCgmDefaults(pathology?: Pathology): CgmThresholds {
  return pathology === "GD" ? CGM_DEFAULTS_GD : CGM_DEFAULTS
}

export const objectivesService = {
  async getAll(patientId: number, auditUserId: number) {
    const [glycemia, cgm, annex, patient] = await Promise.all([
      prisma.glycemiaObjective.findMany({
        where: { patientId, isCurrent: true },
      }),
      prisma.cgmObjective.findUnique({ where: { patientId } }),
      prisma.annexObjective.findUnique({ where: { patientId } }),
      prisma.patient.findUnique({ where: { id: patientId }, select: { pathology: true } }),
    ])

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      resourceId: `${patientId}:objectives`,
    })

    return {
      glycemia,
      cgm: cgm ?? getCgmDefaults(patient?.pathology),
      annex,
    }
  },

  async updateGlycemia(
    patientId: number,
    input: Prisma.GlycemiaObjectiveUncheckedCreateInput[],
    auditUserId: number,
  ) {
    return prisma.$transaction(async (tx) => {
      await tx.glycemiaObjective.updateMany({
        where: { patientId, isCurrent: true },
        data: { isCurrent: false },
      })

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
    input: CgmThresholds,
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
