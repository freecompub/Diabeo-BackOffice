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
import { prisma, type PrismaClientOrTx } from "@/lib/db/client"
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
  /**
   * Client DB optionnel. La re-évaluation sous advisory-lock du harnais (auto-apply.service) passe le `tx`
   * englobant pour éviter de prélever des connexions supplémentaires sur le pool PENDANT une transaction
   * interactive (anti-starvation). READ COMMITTED : sous le lock, `tx` voit aussi les commits concurrents.
   */
  client: PrismaClientOrTx = prisma,
): Promise<EnvelopeContext> {
  const days = Math.max(CLINICAL_BOUNDS.AUTO_APPLY_MIN_WINDOW_DAYS, windowDays ?? CLINICAL_BOUNDS.AUTO_APPLY_MIN_WINDOW_DAYS)
  const nowMs = now.getTime()
  const windowStart = new Date(nowMs - days * DAY_MS)
  const ketoneStart = new Date(nowMs - CLINICAL_BOUNDS.AUTO_APPLY_KETONE_BLOCK_LOOKBACK_HOURS * HOUR_MS)
  const weekStart = new Date(nowMs - 7 * DAY_MS)

  const [cgm, capillary, patient, glyKetones, eventKetones, lastEvent, weekEvents] = await Promise.all([
    client.cgmEntry.findMany({
      where: {
        patientId,
        timestamp: { gte: windowStart, lte: now },
        // Plafond physiologique + exclusion des valeurs non-positives (erreur capteur) SEULEMENT : on ne
        // planche PAS à `CGM_AGGREGATE_RANGE_GL.MIN` (0,20) pour ne pas écarter une hypo sévère (<20 mg/dL)
        // de la garde C6 (fail-safe). Le plancher agrégat reste appliqué en mémoire pour C6b (TIR).
        valueGl: { gt: 0, lte: CGM_AGGREGATE_RANGE_GL.MAX },
      },
      select: { valueGl: true },
    }),
    // Glycémies CAPILLAIRES (BGM) sur la fenêtre — pour la garde hypo C6 (un patient sans capteur doit voir
    // ses hypos au doigt bloquer une hausse d'insuline). Lit g/L ET mg/dL : une hypo saisie en mg/dL SEUL
    // (`glycemiaGl` null) ne doit pas être ignorée (fail-open corrigé). Récence par `createdAt` (conservateur).
    client.glycemiaEntry.findMany({
      where: {
        patientId,
        createdAt: { gte: windowStart, lte: now },
        OR: [{ glycemiaGl: { not: null } }, { glycemiaMgdl: { not: null } }],
      },
      select: { glycemiaGl: true, glycemiaMgdl: true },
    }),
    // Pathologie + mode grossesse → cible glycémique resserrée (DG/grossesse) pour C6b.
    client.patient.findUnique({ where: { id: patientId }, select: { pathology: true, pregnancyMode: true } }),
    // Récence par `createdAt` (heure d'enregistrement) plutôt que `date`+`time` clinique : `createdAt`
    // ≥ heure de mesure, donc une cétone ancienne peut au pire paraître PLUS récente (sur-blocage
    // conservateur) — jamais l'inverse. Fail-safe pour une garde DKA. `DiabetesEvent` a un vrai
    // timestamp unique (`eventDate`) → filtré dessus directement.
    client.glycemiaEntry.findMany({
      where: { patientId, ketones: { not: null }, createdAt: { gte: ketoneStart, lte: now } },
      select: { ketones: true },
    }),
    client.diabetesEvent.findMany({
      where: { patientId, ketones: { not: null }, eventDate: { gte: ketoneStart, lte: now } },
      select: { ketones: true },
    }),
    client.autoApplyEvent.findFirst({
      where: { patientId, parameterType, slotKey },
      orderBy: { appliedAt: "desc" },
      select: { appliedAt: true },
    }),
    client.autoApplyEvent.findMany({
      where: { patientId, parameterType, slotKey, appliedAt: { gte: weekStart, lte: now } },
      select: { deltaPercent: true },
    }),
  ])

  // CGM : toutes les valeurs positives ≤ plafond (inclut les hypos sévères <0,20 pour la garde C6).
  const cgmAll = cgm
    .map((e) => decimalToNumber(e.valueGl))
    .filter((v): v is number => Number.isFinite(v) && v > 0 && v <= CGM_AGGREGATE_RANGE_GL.MAX)
  // C6b (baisse) : CGM-only AVEC plancher agrégat (≥0,20) + `capturePercent` — un patient BGM/faible capture
  // ne peut pas auto-baisser (plancher de suffisance inchangé). Le plancher exclut le bruit capteur des TIR.
  const glucosesGl = cgmAll.filter((v) => v >= CGM_AGGREGATE_RANGE_GL.MIN)
  // Capillaire : COALESCE(g/L, mg/dL÷100) — une hypo saisie en mg/dL SEUL compte (fail-open corrigé). Filtré
  // à la plage physiologique plausible haute + valeurs positives (garbage-in → jamais dans une garde).
  const capillaryGl = capillary
    .map((e) => (e.glycemiaGl != null ? decimalToNumber(e.glycemiaGl) : e.glycemiaMgdl != null ? decimalToNumber(e.glycemiaMgdl) / 100 : NaN))
    .filter((v): v is number => Number.isFinite(v) && v > 0 && v <= CGM_AGGREGATE_RANGE_GL.MAX)
  // C6 (hypo) : CGM ∪ capillaire, SANS plancher bas (une hypo sévère ne doit jamais être écartée).
  const hypoGlucosesGl = [...cgmAll, ...capillaryGl]
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
