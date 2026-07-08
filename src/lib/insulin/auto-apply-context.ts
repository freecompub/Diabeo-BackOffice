/**
 * US-2657 (slice C2a) — Assemblage du **contexte d'entrée** de l'enveloppe d'auto-application experte.
 *
 * Lit (I/O) la fenêtre glycémique, les cétonémies récentes et l'historique anti-cliquet, et les met en
 * forme pour `evaluateAutoApplyEnvelope` (qui, lui, reste PUR). Ne décide RIEN : ni double verrou, ni
 * application — c'est le rôle du harnais (C2b). `now` est injecté (testabilité / pas d'horloge cachée).
 *
 * Choix de design (US-2657, validés) :
 *  - **fenêtre paramétrable, plancher 14 j** (`AUTO_APPLY_MIN_WINDOW_DAYS`) — l'auto-application n'évalue
 *    jamais sur moins que le plancher de suffisance C6b ;
 *  - **cétones = `GlycemiaEntry.ketones` ∪ `DiabetesEvent.ketones`** sur la fenêtre de récence
 *    (`AUTO_APPLY_KETONE_BLOCK_LOOKBACK_HOURS` = 48 h) — couvre les deux voies de saisie ;
 *  - **anti-cliquet** depuis `AutoApplyEvent` scopé (patient × paramètre × créneau).
 */
import type { AdjustableParameter } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { decimalToNumber } from "@/lib/db/decimal"
import { cgmCaptureRate } from "@/lib/statistics"
import { CLINICAL_BOUNDS, CGM_AGGREGATE_RANGE_GL } from "@/lib/clinical-bounds"

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export type EnvelopeContext = {
  glycemia: {
    glucosesGl: number[]
    capturePercent: number
    windowDays: number
    recentKetonesMmol: number[]
    ketoneModerateThreshold: number
  }
  ratchet: {
    hoursSinceLastAutoApply: number | null
    cumulativeAbsPercentThisWeek: number
  }
}

/**
 * Assemble le contexte glycémie + anti-cliquet pour un patient et un créneau donné.
 * @param patientId Patient (déjà autorisé par l'appelant).
 * @param parameterType Paramètre édité (pour scoper l'anti-cliquet).
 * @param slotKey Identifiant du créneau (ex. `"22-06"`) — scope l'anti-cliquet par créneau.
 * @param ketoneModerateThreshold Seuil modéré cétone du patient (mmol/L ; défaut 1,5 côté appelant).
 * @param now Instant de référence (injecté).
 * @param windowDays Fenêtre demandée ; **planchée à `AUTO_APPLY_MIN_WINDOW_DAYS`** (14 j).
 */
export async function buildEnvelopeContext(
  patientId: number,
  parameterType: AdjustableParameter,
  slotKey: string,
  ketoneModerateThreshold: number,
  now: Date,
  windowDays?: number,
): Promise<EnvelopeContext> {
  const days = Math.max(CLINICAL_BOUNDS.AUTO_APPLY_MIN_WINDOW_DAYS, windowDays ?? CLINICAL_BOUNDS.AUTO_APPLY_MIN_WINDOW_DAYS)
  const nowMs = now.getTime()
  const windowStart = new Date(nowMs - days * DAY_MS)
  const ketoneStart = new Date(nowMs - CLINICAL_BOUNDS.AUTO_APPLY_KETONE_BLOCK_LOOKBACK_HOURS * HOUR_MS)
  const weekStart = new Date(nowMs - 7 * DAY_MS)

  const [cgm, glyKetones, eventKetones, lastEvent, weekEvents] = await Promise.all([
    prisma.cgmEntry.findMany({
      where: {
        patientId,
        timestamp: { gte: windowStart, lte: now },
        valueGl: { gte: CGM_AGGREGATE_RANGE_GL.MIN, lte: CGM_AGGREGATE_RANGE_GL.MAX },
      },
      select: { valueGl: true },
    }),
    prisma.glycemiaEntry.findMany({
      where: { patientId, ketones: { not: null }, createdAt: { gte: ketoneStart, lte: now } },
      select: { ketones: true },
    }),
    prisma.diabetesEvent.findMany({
      where: { patientId, ketones: { not: null }, eventDate: { gte: ketoneStart, lte: now } },
      select: { ketones: true },
    }),
    prisma.autoApplyEvent.findFirst({
      where: { patientId, parameterType, slotKey },
      orderBy: { appliedAt: "desc" },
      select: { appliedAt: true },
    }),
    prisma.autoApplyEvent.findMany({
      where: { patientId, parameterType, slotKey, appliedAt: { gte: weekStart, lte: now } },
      select: { deltaPercent: true },
    }),
  ])

  const glucosesGl = cgm.map((e) => decimalToNumber(e.valueGl))
  const recentKetonesMmol = [...glyKetones, ...eventKetones]
    .map((k) => decimalToNumber(k.ketones))
    .filter((v): v is number => Number.isFinite(v))

  const cumulativeAbsPercentThisWeek = weekEvents.reduce((s, e) => s + Math.abs(e.deltaPercent), 0)
  const hoursSinceLastAutoApply = lastEvent ? (nowMs - lastEvent.appliedAt.getTime()) / HOUR_MS : null

  return {
    glycemia: {
      glucosesGl,
      capturePercent: cgmCaptureRate(glucosesGl.length, days),
      windowDays: days,
      recentKetonesMmol,
      ketoneModerateThreshold,
    },
    ratchet: { hoursSinceLastAutoApply, cumulativeAbsPercentThisWeek },
  }
}
