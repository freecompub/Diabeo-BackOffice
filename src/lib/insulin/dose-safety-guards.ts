/**
 * US-2657 (slice B) — Gardes de sécurité PURES sur une fenêtre glycémique, partagées entre le
 * générateur de propositions (garde hypo des analyseurs) et l'enveloppe d'auto-application (C6/C6b).
 * **Source unique** pour éviter que les deux implémentations dérivent (régression de sécurité silencieuse).
 *
 * Client-safe (aucune dépendance serveur ; `computeTir` et les seuils sont purs).
 */
import { GLYCEMIA_THRESHOLDS_MGDL } from "@/lib/glycemia-thresholds"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"
import { computeTir, DEFAULT_CGM_THRESHOLDS, type CgmThresholds } from "@/lib/statistics"

const SEVERE_HYPO_GL = GLYCEMIA_THRESHOLDS_MGDL.SEVERE_HYPO / 100
const LEVEL1_HYPO_GL = GLYCEMIA_THRESHOLDS_MGDL.TARGET_LOW / 100

/**
 * Garde HYPO (fenêtre) — bloque une HAUSSE d'insuline si un signal hypo récent est présent :
 *  - **une** hypo sévère (niveau 2, `< SEVERE_HYPO_GL` = 0,54 g/L) suffit (urgence) ; OU
 *  - **≥ `HYPO_LEVEL1_RECURRENCE_MIN`** hypos niveau 1 (`< LEVEL1_HYPO_GL` = 0,70 g/L) — récurrence.
 * Test glycémique pur (sans direction) : l'appelant vérifie séparément le sens « plus d'insuline ».
 */
export function hypoWindowBlocks(glucosesGl: number[]): boolean {
  const hasSevere = glucosesGl.some((g) => g < SEVERE_HYPO_GL)
  const level1 = glucosesGl.filter((g) => g < LEVEL1_HYPO_GL).length
  return hasSevere || level1 >= CLINICAL_BOUNDS.HYPO_LEVEL1_RECURRENCE_MIN
}

/** Motif de blocage d'une BAISSE d'insuline auto-appliquée (C6b). `null` = pas de blocage. */
export type HyperBlockReason = "insufficientData" | "ketosis" | "severeHyper" | "sustainedHyper"

/**
 * Garde HYPER / sous-dosage (C6b) — décide si une **BAISSE d'insuline** peut s'auto-appliquer.
 *
 * **Asymétrie fail-closed positive.** La garde hypo (C6) bloque une hausse sur un signal hypo *présent*
 * (elle ne bloque pas sur l'absence de donnée — asymétrie assumée, la hausse restant bornée par C3/C7).
 * Ici, à l'inverse, l'action dangereuse EST la baisse : elle ne peut s'auto-appliquer que si des données
 * récentes **prouvent positivement** que le patient n'est pas en hyper → **plancher de suffisance**.
 *
 * Bloque (renvoie un motif) si l'UN de :
 *  - **plancher non atteint** (`insufficientData`) : fenêtre < `AUTO_APPLY_MIN_WINDOW_DAYS` (14 j) OU
 *    capture < `AUTO_APPLY_MIN_CAPTURE_RATE_PERCENT` (70 %) OU moins de `AUTO_APPLY_MIN_WINDOW_READINGS`
 *    relevés valides (backstop anti-tableau-dégénéré) → un patient BGM/faible capture n'auto-baisse jamais ;
 *  - **cétose** (`ketosis`) : une cétonémie récente (déjà filtrée à la fenêtre de récence) ≥ seuil modéré
 *    patient — trigger POSITIF seulement (l'absence de mesure n'autorise jamais) ;
 *  - **hyper sévère** (`severeHyper`) : TAR>250 (`tir.hyper`) > `AUTO_APPLY_SEVERE_TAR_BLOCK_PERCENT` (10 %) ;
 *  - **hyper soutenue** (`sustainedHyper`) : TAR>180 (`tir.elevated + tir.hyper`) > `AUTO_APPLY_TAR_BLOCK_PERCENT` (30 %).
 *
 * @param glucosesGl Relevés glycémiques de la fenêtre (g/L).
 * @param capturePercent Taux de capture CGM (%) sur la fenêtre.
 * @param windowDays Nombre de jours de la fenêtre.
 * @param recentKetonesMmol Cétonémies (mmol/L) déjà filtrées à `AUTO_APPLY_KETONE_BLOCK_LOOKBACK_HOURS`.
 * @param ketoneModerateThreshold Seuil modéré cétone du patient (mmol/L ; défaut 1,5 côté appelant).
 * @param thresholds Seuils CGM **pathology-aware** (cible resserrée grossesse/DG : `ok=1,40` vs `1,80`).
 *   Défaut adulte (`DEFAULT_CGM_THRESHOLDS`) — l'appelant (contexte serveur) passe `getCgmDefaults(pathologie)`
 *   pour que la détection d'hyper soutenue soit correcte en grossesse/DG (US-2657 durcissement).
 */
export function hyperDecreaseBlockReason(
  glucosesGl: number[],
  capturePercent: number,
  windowDays: number,
  recentKetonesMmol: number[],
  ketoneModerateThreshold: number,
  thresholds: CgmThresholds = DEFAULT_CGM_THRESHOLDS,
): HyperBlockReason | null {
  // Relevés valides seulement (un NaN fausserait computeTir vers la bande hyper).
  const validGl = glucosesGl.filter((g) => Number.isFinite(g))
  if (
    windowDays < CLINICAL_BOUNDS.AUTO_APPLY_MIN_WINDOW_DAYS ||
    capturePercent < CLINICAL_BOUNDS.AUTO_APPLY_MIN_CAPTURE_RATE_PERCENT ||
    validGl.length < CLINICAL_BOUNDS.AUTO_APPLY_MIN_WINDOW_READINGS
  ) {
    return "insufficientData"
  }
  if (recentKetonesMmol.some((k) => Number.isFinite(k) && k >= ketoneModerateThreshold)) return "ketosis"

  const tir = computeTir(validGl, thresholds)
  if (tir.hyper > CLINICAL_BOUNDS.AUTO_APPLY_SEVERE_TAR_BLOCK_PERCENT) return "severeHyper"
  if (tir.elevated + tir.hyper > CLINICAL_BOUNDS.AUTO_APPLY_TAR_BLOCK_PERCENT) return "sustainedHyper"
  return null
}
