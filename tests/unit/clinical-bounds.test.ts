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
  DASHBOARD_TIR, AGP_SUFFICIENCY, HBA1C_STALE_DAYS, OBSERVANCE,
  HBA1C_HIGH_DEFAULT_PERCENT, HBA1C_HIGH_DEFAULT_PREGNANCY_PERCENT, HBA1C_TARGET_MARGIN_PERCENT,
  isDeliverableBasalRate,
} from "@/lib/clinical-bounds"

describe("isDeliverableBasalRate — multiple de l'incrément pompe (US-2648b)", () => {
  it("accepte les multiples de 0,05 sur toute la plage (FP-safe)", () => {
    for (const v of [0.05, 0.15, 0.35, 0.95, 1.15, 2.85, 5.0]) {
      expect(isDeliverableBasalRate(v)).toBe(true)
    }
  })
  it("rejette les débits hors incrément (non délivrables)", () => {
    for (const v of [0.037, 0.37, 0.12, 0.051, 0.025]) {
      expect(isDeliverableBasalRate(v)).toBe(false)
    }
  })
})

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
      // US-2646 — dose fixe (mode « doses simples ») : plancher bloquant + seuils warn
      FIXED_DOSE_MIN: 0.5,
      FIXED_BOLUS_WARN_U: 25.0,
      FIXED_BASAL_WARN_U: 80.0,
      FIXED_DOSE_MAX_DELTA_U: 2.0,
      FIXED_DOSE_PATIENT_MAX_DELTA_U: 1.0,
      FIXED_DOSE_MAX_CHANGE_PERCENT: 10,
      FIXED_DOSE_DELIVERY_INCREMENT_U: 0.5,
      FIXED_DOSE_COOLDOWN_HOURS: 72,
      MAX_CHANGE_PERCENT: 20,
      PATIENT_MAX_CHANGE_PERCENT: 10,
      PATIENT_PROPOSAL_COOLDOWN_HOURS: 24,
      HYPO_LEVEL1_RECURRENCE_MIN: 2,
      POSTPRANDIAL_TITRATION_LOW_GL: 1.0,
      POSTPRANDIAL_TITRATION_LOW_PREGNANCY_GL: 0.9,
      POSTMEAL_NADIR_WINDOW_MIN: 300,
      ICR_PREMEAL_MIN_GL: 0.7,
      ICR_PREMEAL_MAX_GL: 1.4,
      ICR_PREMEAL_MAX_PREGNANCY_GL: 1.1,
      HYPO_DEESCALATION_PERCENT: 10,
      NOCTURNAL_TITRATION_REF_HOUR: 5,
      FASTING_TARGET_DEFAULT_GL: 1.0,
      FASTING_TARGET_PREGNANCY_GL: 0.9,
      FASTING_TARGET_MIN_GL: 0.8,
      FASTING_TARGET_MAX_GL: 1.3,
      FASTING_TARGET_MAX_PREGNANCY_GL: 1.0,
      CORRECTION_MIN_ELEVATION_GL: 0.3,
      CORRECTION_SETTLE_TOL_MIN: 30,
      CORRECTION_COB_LOOKBACK_MIN: 180,
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

  it("US-2646 — dose fixe : plancher > 0, seuils warn bolus < basal, cap patient < moteur", () => {
    expect(CLINICAL_BOUNDS.FIXED_DOSE_MIN).toBeGreaterThan(0)
    // seuils d'AVERTISSEMENT (non bloquants) : le bolus fixe alerte plus tôt que la basale
    expect(CLINICAL_BOUNDS.FIXED_DOSE_MIN).toBeLessThan(CLINICAL_BOUNDS.FIXED_BOLUS_WARN_U)
    expect(CLINICAL_BOUNDS.FIXED_BOLUS_WARN_U).toBeLessThan(CLINICAL_BOUNDS.FIXED_BASAL_WARN_U)
    // cap de variation patient strictement plus strict que le cap moteur
    expect(CLINICAL_BOUNDS.FIXED_DOSE_PATIENT_MAX_DELTA_U).toBeLessThan(CLINICAL_BOUNDS.FIXED_DOSE_MAX_DELTA_U)
  })

  it("US-2651 — deadband ICR : borne basse < plafond adulte (1,80), grossesse plus stricte", () => {
    // borne basse post-prandiale strictement sous le plafond adulte → deadband non vide
    expect(CLINICAL_BOUNDS.POSTPRANDIAL_TITRATION_LOW_GL).toBeLessThan(1.8)
    // grossesse plus stricte que l'adulte (borne basse resserrée)
    expect(CLINICAL_BOUNDS.POSTPRANDIAL_TITRATION_LOW_PREGNANCY_GL)
      .toBeLessThan(CLINICAL_BOUNDS.POSTPRANDIAL_TITRATION_LOW_GL)
    expect(CLINICAL_BOUNDS.POSTMEAL_NADIR_WINDOW_MIN).toBeGreaterThan(120) // > le point PPG 2 h
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

  it("fige les seuils du flag hba1cAboveTarget (US-2651 mode c, validé medical)", () => {
    expect(HBA1C_HIGH_DEFAULT_PERCENT).toBe(8.0)
    expect(HBA1C_HIGH_DEFAULT_PREGNANCY_PERCENT).toBe(6.0)
    expect(HBA1C_TARGET_MARGIN_PERCENT).toBe(0.5)
    expect(HBA1C_HIGH_DEFAULT_PREGNANCY_PERCENT).toBeLessThan(HBA1C_HIGH_DEFAULT_PERCENT)
  })

  it("fige les seuils du flag observance (US-2651 mode c, validé medical)", () => {
    expect(OBSERVANCE).toEqual({
      WINDOW_DAYS: 30,
      MIN_CGM_CAPTURE_RATE: 30,
      BGM_MIN_READINGS_DEFAULT: 4,
      BGM_MIN_READINGS_PREGNANCY: 30,
      MIN_ENROLLMENT_DAYS: 30,
    })
    // Grossesse plus stricte (population critique) + capture CGM alignée sur le plancher TIR.
    expect(OBSERVANCE.BGM_MIN_READINGS_PREGNANCY).toBeGreaterThan(OBSERVANCE.BGM_MIN_READINGS_DEFAULT)
    expect(OBSERVANCE.MIN_CGM_CAPTURE_RATE).toBe(DASHBOARD_TIR.MIN_CAPTURE_RATE)
  })

  it("invariants : cible TIR > plancher ; suffisance bornée", () => {
    expect(DASHBOARD_TIR.TARGET_PERCENT).toBeGreaterThan(DASHBOARD_TIR.LOW_PERCENT)
    expect(AGP_SUFFICIENCY.MIN_SLOT_READINGS).toBeGreaterThanOrEqual(5)
    expect(AGP_SUFFICIENCY.MIN_DAYS).toBeGreaterThanOrEqual(14)
  })
})
