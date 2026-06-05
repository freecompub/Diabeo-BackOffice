/**
 * Anti-drift guard for clinical safety bounds (anomalie A3).
 *
 * `src/lib/clinical-bounds.ts` est la SOURCE DE VÉRITÉ UNIQUE des bornes
 * cliniques. CLAUDE.md en contient une copie pédagogique qui avait dérivé
 * (ISF 0.20 vs 0.10, ICR 5–20 vs 3–30, Basal max 10 vs 5).
 *
 * Ce test verrouille les valeurs : toute modification de `clinical-bounds.ts`
 * casse ce test, ce qui force la mise à jour synchrone de CLAUDE.md (bloc
 * « CLINICAL_BOUNDS ») dans la même PR. Sécurité patient → changement explicite.
 *
 * @see CLAUDE.md — section « Calcul de bolus » / CLINICAL_BOUNDS
 */

import { describe, it, expect } from "vitest"
import { CLINICAL_BOUNDS } from "@/lib/clinical-bounds"

describe("CLINICAL_BOUNDS — anti-drift (A3)", () => {
  it("matche exactement les valeurs documentées dans CLAUDE.md", () => {
    expect(CLINICAL_BOUNDS).toEqual({
      ISF_GL_MIN: 0.1,
      ISF_GL_MAX: 1.0,
      ISF_MGDL_MIN: 10,
      ISF_MGDL_MAX: 100,
      ICR_MIN: 3.0,
      ICR_MAX: 30.0,
      BASAL_MIN: 0.05,
      BASAL_MAX: 5.0,
      TARGET_MIN_MGDL: 60,
      TARGET_MAX_MGDL: 250,
      MAX_SINGLE_BOLUS: 25.0,
      INSULIN_ACTION_MIN: 3.5,
      INSULIN_ACTION_MAX: 5.0,
      PUMP_BASAL_INCREMENT: 0.05,
    })
  })

  it("respecte les invariants min < max (cohérence interne)", () => {
    expect(CLINICAL_BOUNDS.ISF_GL_MIN).toBeLessThan(CLINICAL_BOUNDS.ISF_GL_MAX)
    expect(CLINICAL_BOUNDS.ISF_MGDL_MIN).toBeLessThan(CLINICAL_BOUNDS.ISF_MGDL_MAX)
    expect(CLINICAL_BOUNDS.ICR_MIN).toBeLessThan(CLINICAL_BOUNDS.ICR_MAX)
    expect(CLINICAL_BOUNDS.BASAL_MIN).toBeLessThan(CLINICAL_BOUNDS.BASAL_MAX)
    expect(CLINICAL_BOUNDS.TARGET_MIN_MGDL).toBeLessThan(CLINICAL_BOUNDS.TARGET_MAX_MGDL)
    expect(CLINICAL_BOUNDS.INSULIN_ACTION_MIN).toBeLessThan(CLINICAL_BOUNDS.INSULIN_ACTION_MAX)
  })
})
