/**
 * @module glucose/units
 * @description Source de vérité UNIQUE des conversions d'unités glycémiques (ADR #32).
 *
 * Unité **canonique** du backoffice = **g/L** (stockage `cgm_entries.value_gl` /
 * `glycemia_entries.glycemia_gl`, contrat API, logique clinique). Toute conversion
 * `g/L ↔ mg/dL ↔ mmol/L` DOIT transiter par ce module — ne jamais ré-implémenter un
 * `× 100` / `/ 100` ailleurs (cf. inventaire des conversions dupliquées).
 *
 * ⚠️ **Module PUR, sans aucune dépendance** (ni Prisma, ni Redis, ni service) : il est
 * importable **côté client ET côté serveur**. Ne jamais y ajouter d'import qui tirerait
 * un module serveur — cela ferait fuiter Prisma dans le bundle navigateur
 * (invisible à `tsc`/vitest, cassé au build/E2E).
 *
 * **Convention Diabeo** : `1 g/L = 100 mg/dL` (jamais ×18). Le facteur molaire du glucose
 * (÷18,0182) n'intervient **que** pour l'affichage en mmol/L (unité SI).
 *
 * @see docs/architecture/adr-normalisation-unites-glycemie.md
 * @see docs/clinical-logic/regles-et-constantes-diabete.md §3
 */

/**
 * Facteur de conversion g/L → mg/dL (convention Diabeo, jamais ×18).
 * @example glToMgdl(1.50) === 150
 */
export const MGDL_PER_GL = 100

/**
 * Masse molaire du glucose (mg/dL → mmol/L). 1 mmol/L = 18,0182 mg/dL.
 * Utilisé **uniquement** pour l'affichage mmol/L (unité SI internationale).
 */
export const MGDL_PER_MMOLL = 18.0182

/**
 * Codes d'unité d'affichage (`UserUnitPreferences.unitGlycemia`).
 * 3 = g/L (France), 4 = mg/dL (US), 5 = mmol/L (SI, reste du monde).
 */
export type GlucoseUnitCode = 3 | 4 | 5

/** Libellé lisible d'une unité de glycémie. */
export type GlucoseUnitLabel = "g/L" | "mg/dL" | "mmol/L"

/**
 * Convertit une glycémie de g/L vers mg/dL.
 * @param gl - Glycémie en g/L (unité canonique).
 * @returns Glycémie en mg/dL.
 * @example glToMgdl(1.20) // 120
 */
export function glToMgdl(gl: number): number {
  return gl * MGDL_PER_GL
}

/**
 * Convertit une glycémie de mg/dL vers g/L (unité canonique).
 * Frontière de lecture pour les rares entrées mg/dL (ex. seuils exprimés en mg/dL).
 * @param mgdl - Glycémie en mg/dL.
 * @returns Glycémie en g/L.
 * @example mgdlToGl(120) // 1.2
 */
export function mgdlToGl(mgdl: number): number {
  return mgdl / MGDL_PER_GL
}

/**
 * Convertit une glycémie de mg/dL vers mmol/L (affichage SI uniquement).
 * @param mgdl - Glycémie en mg/dL.
 * @returns Glycémie en mmol/L.
 * @example mgdlToMmoll(180) // ≈ 9.99
 */
export function mgdlToMmoll(mgdl: number): number {
  return mgdl / MGDL_PER_MMOLL
}

/**
 * Convertit une glycémie de g/L vers mmol/L (affichage SI uniquement).
 * @param gl - Glycémie en g/L (unité canonique).
 * @returns Glycémie en mmol/L.
 * @example glToMmoll(1.80) // ≈ 9.99
 */
export function glToMmoll(gl: number): number {
  return mgdlToMmoll(glToMgdl(gl))
}

/** Libellé d'unité pour un code de préférence (`unitGlycemia`). Défaut mg/dL. */
export function glucoseUnitLabel(code: GlucoseUnitCode): GlucoseUnitLabel {
  switch (code) {
    case 3:
      return "g/L"
    case 5:
      return "mmol/L"
    case 4:
    default:
      return "mg/dL"
  }
}

/**
 * Formate une glycémie **stockée en g/L** vers l'unité d'affichage préférée du
 * consommateur (`UserUnitPreferences.unitGlycemia`). C'est le **seul** point où la
 * conversion pour l'affichage doit se faire (couche présentation, ADR #32).
 *
 * Précision d'affichage par unité (usage clinique) :
 * - g/L  → 2 décimales (ex. 1,20 g/L)
 * - mg/dL → entier (ex. 120 mg/dL)
 * - mmol/L → 1 décimale (ex. 6,7 mmol/L)
 *
 * @param gl - Glycémie en g/L (unité canonique de stockage/API).
 * @param code - Code d'unité d'affichage (3=g/L, 4=mg/dL, 5=mmol/L). Défaut mg/dL.
 * @returns `{ value, unit }` — valeur arrondie à la précision de l'unité + libellé.
 * @example
 * formatGlucose(1.20, 4) // { value: 120, unit: "mg/dL" }
 * formatGlucose(1.20, 3) // { value: 1.2, unit: "g/L" }
 * formatGlucose(1.80, 5) // { value: 10, unit: "mmol/L" }
 */
export function formatGlucose(
  gl: number,
  code: GlucoseUnitCode = 4,
): { value: number; unit: GlucoseUnitLabel } {
  switch (code) {
    case 3:
      return { value: Math.round(gl * 100) / 100, unit: "g/L" }
    case 5:
      return { value: Math.round(glToMmoll(gl) * 10) / 10, unit: "mmol/L" }
    case 4:
    default:
      return { value: Math.round(glToMgdl(gl)), unit: "mg/dL" }
  }
}

/**
 * Variante de {@link formatGlucose} pour une valeur **en mg/dL** en entrée.
 * Utile aux consommateurs d'affichage dont la source est déjà en mg/dL (stats
 * analytics `avgMgdl`, seuils de zone `GLYCEMIA_THRESHOLDS_MGDL`, axes de charts
 * dont le repère clinique reste mg/dL). Convertit d'abord en g/L (unité pivot).
 *
 * @param mgdl - Glycémie en mg/dL.
 * @param code - Code d'unité d'affichage (3=g/L, 4=mg/dL, 5=mmol/L). Défaut mg/dL.
 * @returns `{ value, unit }` arrondi à la précision de l'unité + libellé.
 * @example formatGlucoseFromMgdl(180, 5) // { value: 10, unit: "mmol/L" }
 */
export function formatGlucoseFromMgdl(
  mgdl: number,
  code: GlucoseUnitCode = 4,
): { value: number; unit: GlucoseUnitLabel } {
  return formatGlucose(mgdlToGl(mgdl), code)
}

/**
 * Convertit une valeur **mg/dL** vers le NOMBRE d'affichage dans l'unité choisie
 * (sans libellé). Raccourci pour les `tickFormatter`/tooltips de charts dont les
 * données internes restent en mg/dL (le repère clinique de zones ne bouge pas).
 *
 * @param mgdl - Glycémie en mg/dL.
 * @param code - Code d'unité d'affichage. Défaut mg/dL.
 * @returns Nombre arrondi à la précision de l'unité.
 */
export function mgdlToDisplayValue(mgdl: number, code: GlucoseUnitCode = 4): number {
  return formatGlucoseFromMgdl(mgdl, code).value
}
