/**
 * @module objectives.service
 * @description Glycemia and CGM objectives (goals and thresholds).
 * Supports pathology-aware defaults (tighter thresholds for gestational diabetes).
 * All objectives are patient-specific and used for analytics (TIR assessment).
 * @see CLAUDE.md#objectives — Glycemia/CGM objective domains
 */

import { prisma } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { Pathology, Prisma } from "@prisma/client"

/**
 * CGM threshold shape — compatible with CgmObjective Decimal fields.
 * Values in g/L (0.54 = 54 mg/dL).
 * @typedef {Object} CgmThresholds
 * @property {number} veryLow - Severe hypoglycemia threshold (< 54 mg/dL)
 * @property {number} low - Hypoglycemia threshold (< 70 mg/dL)
 * @property {number} ok - Upper normal threshold (≤ 180 mg/dL)
 * @property {number} high - Hyperglycemia threshold (> 180 mg/dL)
 * @property {number} titrLow - TITR target lower bound
 * @property {number} titrHigh - TITR target upper bound
 */
interface CgmThresholds {
  veryLow: number
  low: number
  ok: number
  high: number
  titrLow: number
  titrHigh: number
}

/**
 * CGM defaults per ADA/EASD consensus — Type 1 & Type 2 diabetes.
 * @constant
 * @see https://diabetes.org/about-us/statistics/statistics-about-diabetes — ADA guidelines
 */
const CGM_DEFAULTS: CgmThresholds = {
  veryLow: 0.54,
  low: 0.70,
  ok: 1.80,
  high: 2.50,
  titrLow: 0.70,
  titrHigh: 1.80,
}

/**
 * Tighter CGM defaults for gestational diabetes (ADA/ACOG/Battelino 2019 consensus).
 * GD requires stricter control to prevent fetal complications.
 *  - veryLow=0.60 g/L (60 mg/dL): earlier critical alert in pregnancy where
 *    < 63 mg/dL is already considered hypoglycemia (Battelino 2019 *Diabetes Care*).
 *  - high=2.00 g/L (200 mg/dL): clinically significant hyperglycemia in pregnancy.
 * @constant
 * @see https://www.acog.org/ — ACOG gestational diabetes guidelines
 * @see Battelino T. et al., *Diabetes Care* 2019 — Time in Range targets in pregnancy
 */
const CGM_DEFAULTS_GD: CgmThresholds = {
  veryLow: 0.60,
  low: 0.63,
  ok: 1.40,
  high: 2.00,
  titrLow: 0.63,
  titrHigh: 1.40,
}

/**
 * Get pathology-aware CGM defaults.
 * Returns tighter thresholds for gestational diabetes, standard for T1D/T2D.
 * @export
 * @param {Pathology} [pathology] - Patient pathology (DT1, DT2, or GD)
 * @returns {CgmThresholds} Appropriate thresholds
 */
export function getCgmDefaults(pathology?: Pathology): CgmThresholds {
  return pathology === "GD" ? CGM_DEFAULTS_GD : CGM_DEFAULTS
}

/**
 * Objectives service — glycemia, CGM, annex objectives (CRUD).
 * @namespace objectivesService
 */
export const objectivesService = {
  /**
   * Get all objectives for a patient.
   * Returns defaults if not yet set.
   * @async
   * @param {number} patientId - Patient ID
   * @param {number} auditUserId - User performing read (audit trail)
   * @returns {Promise<{glycemia, cgm, annex}>} All objective types
   */
  async getAll(patientId: number, auditUserId: number) {
    const [glycemia, cgm, annex, patient] = await Promise.all([
      prisma.glycemiaObjective.findMany({
        where: { patientId, isCurrent: true },
      }),
      prisma.cgmObjective.findUnique({ where: { patientId } }),
      prisma.annexObjective.findUnique({ where: { patientId } }),
      // US-SEC-002: enforce soft-delete at service layer (defense in depth
      // against a future route invoking this without canAccessPatient).
      prisma.patient.findFirst({
        where: { id: patientId, deletedAt: null },
        select: { pathology: true },
      }),
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
