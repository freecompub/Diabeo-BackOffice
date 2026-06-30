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
import { readFileSync } from "node:fs"
import {
  CLINICAL_BOUNDS, CGM_AGGREGATE_RANGE_GL,
  DASHBOARD_TIR, AGP_SUFFICIENCY, HBA1C_STALE_DAYS,
} from "@/lib/clinical-bounds"

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

describe("CGM_AGGREGATE_RANGE_GL — anti-drift vs DB CHECK", () => {
  it("matche exactement le CHECK base (cgm_partitioning.sql : 0.20–6.00)", () => {
    expect(CGM_AGGREGATE_RANGE_GL).toEqual({ MIN: 0.2, MAX: 6.0 })
    // Vérifie l'alignement réel avec le DDL (source de vérité base) — le CHECK
    // écrit les bornes en DECIMAL(6,4) → on compare en 2 décimales.
    const ddl = readFileSync("prisma/sql/cgm_partitioning.sql", "utf8")
    expect(ddl).toContain(`>= ${CGM_AGGREGATE_RANGE_GL.MIN.toFixed(2)}`) // ">= 0.20"
    expect(ddl).toContain(`<= ${CGM_AGGREGATE_RANGE_GL.MAX.toFixed(2)}`) // "<= 6.00"
  })

  it("englobe strictement le plancher d'affichage 0.40–5.00 (agrégats ⊃ série)", () => {
    expect(CGM_AGGREGATE_RANGE_GL.MIN).toBeLessThan(0.4)
    expect(CGM_AGGREGATE_RANGE_GL.MAX).toBeGreaterThan(5.0)
  })
})

describe("DASHBOARD_TIR / AGP_SUFFICIENCY / HBA1C_STALE_DAYS — anti-drift (fiche patient)", () => {
  it("fige les paliers TIR dashboard (US-2625)", () => {
    expect(DASHBOARD_TIR).toEqual({ TARGET_PERCENT: 70, LOW_PERCENT: 50, MIN_CAPTURE_RATE: 30 })
  })

  it("fige les seuils de suffisance AGP (US-2631, ATTD/Battelino)", () => {
    expect(AGP_SUFFICIENCY).toEqual({ MIN_DAYS: 14, MIN_CAPTURE_RATE: 70, MIN_SLOT_READINGS: 5 })
  })

  it("fige la péremption HbA1c labo (US-2631, ~6 mois)", () => {
    expect(HBA1C_STALE_DAYS).toBe(180)
  })

  it("invariants : cible TIR > plancher ; suffisance bornée", () => {
    expect(DASHBOARD_TIR.TARGET_PERCENT).toBeGreaterThan(DASHBOARD_TIR.LOW_PERCENT)
    expect(AGP_SUFFICIENCY.MIN_SLOT_READINGS).toBeGreaterThanOrEqual(5)
    expect(AGP_SUFFICIENCY.MIN_DAYS).toBeGreaterThanOrEqual(14)
  })
})
