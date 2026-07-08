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
import { cgmCaptureRate, type CgmThresholds } from "@/lib/statistics"
import { CLINICAL_BOUNDS, CGM_AGGREGATE_RANGE_GL } from "@/lib/clinical-bounds"
import { getCgmDefaults } from "@/lib/services/objectives.service"

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export type EnvelopeContext = {
  glycemia: {
    glucosesGl: number[]
    hypoGlucosesGl: number[]
    capturePercent: number
    windowDays: number
    recentKetonesMmol: number[]
    ketoneModerateThreshold: number
    cgmThresholds: CgmThresholds
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

  const [cgm, capillary, patient, glyKetones, eventKetones, lastEvent, weekEvents] = await Promise.all([
    prisma.cgmEntry.findMany({
      where: {
        patientId,
        timestamp: { gte: windowStart, lte: now },
        valueGl: { gte: CGM_AGGREGATE_RANGE_GL.MIN, lte: CGM_AGGREGATE_RANGE_GL.MAX },
      },
      select: { valueGl: true },
    }),
    // Glycémies CAPILLAIRES (BGM) sur la fenêtre — pour la garde hypo C6 (un patient sans capteur doit
    // voir ses hypos au doigt bloquer une hausse d'insuline). Récence par `createdAt` (conservateur).
    prisma.glycemiaEntry.findMany({
      where: { patientId, glycemiaGl: { not: null }, createdAt: { gte: windowStart, lte: now } },
      select: { glycemiaGl: true },
    }),
    // Pathologie + mode grossesse → cible glycémique resserrée (DG/grossesse) pour C6b.
    prisma.patient.findUnique({ where: { id: patientId }, select: { pathology: true, pregnancyMode: true } }),
    // Récence par `createdAt` (heure d'enregistrement) plutôt que `date`+`time` clinique : `createdAt`
    // ≥ heure de mesure, donc une cétone ancienne peut au pire paraître PLUS récente (sur-blocage
    // conservateur) — jamais l'inverse. Fail-safe pour une garde DKA. `DiabetesEvent` a un vrai
    // timestamp unique (`eventDate`) → filtré dessus directement.
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
  // Capillaire filtré à la plage physiologique plausible (garbage-in → jamais dans une garde de sécurité).
  const capillaryGl = capillary
    .map((e) => decimalToNumber(e.glycemiaGl))
    .filter((v): v is number => Number.isFinite(v) && v >= CGM_AGGREGATE_RANGE_GL.MIN && v <= CGM_AGGREGATE_RANGE_GL.MAX)
  // C6 (hypo) : CGM ∪ capillaire. C6b (baisse) reste CGM-only via `glucosesGl` + `capturePercent` (un patient
  // BGM/faible capture ne peut pas auto-baisser — plancher de suffisance inchangé).
  const hypoGlucosesGl = [...glucosesGl, ...capillaryGl]
  const recentKetonesMmol = [...glyKetones, ...eventKetones]
    .map((k) => decimalToNumber(k.ketones))
    .filter((v): v is number => Number.isFinite(v))

  // Cible pathology-aware (C6b) : grossesse OU DG → seuils resserrés (`getCgmDefaults("GD")`, ok=1,40 g/L).
  const cgmThresholds = getCgmDefaults(patient?.pregnancyMode ? "GD" : (patient?.pathology ?? undefined))

  const cumulativeAbsPercentThisWeek = weekEvents.reduce((s, e) => s + Math.abs(e.deltaPercent), 0)
  const hoursSinceLastAutoApply = lastEvent ? (nowMs - lastEvent.appliedAt.getTime()) / HOUR_MS : null

  return {
    glycemia: {
      glucosesGl,
      hypoGlucosesGl,
      capturePercent: cgmCaptureRate(glucosesGl.length, days),
      windowDays: days,
      recentKetonesMmol,
      ketoneModerateThreshold,
      cgmThresholds,
    },
    ratchet: { hoursSinceLastAutoApply, cumulativeAbsPercentThisWeek },
  }
}
