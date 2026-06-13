/**
 * Garde anti-drift des seuils glycémiques (US-2117 suite).
 *
 * Comportement clinique testé : les seuils d'affichage glycémiques (zones
 * hypo/cible/hyper) ont UNE seule source de vérité (`glycemia-thresholds.ts`).
 * Risque associé : une copie divergente (cf. le drift ISF/ICR corrigé sur la
 * page insulinothérapie) ferait afficher des zones erronées à des seuils
 * différents selon le composant — confusion clinique potentielle.
 *
 * Ce test fige les valeurs de consensus (tout changement devient explicite en
 * revue) ET vérifie que les formes consommatrices dérivent bien de la source
 * (pas de re-hardcode).
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { GLYCEMIA_THRESHOLDS_MGDL } from "@/lib/glycemia-thresholds"
import { DEFAULT_THRESHOLDS as CHART_DEFAULTS } from "@/components/diabeo/charts/types"

describe("glycemia-thresholds — source de vérité", () => {
  it("fige les seuils de consensus ADA/ATTD (mg/dL)", () => {
    // Toute modification de ces valeurs doit être délibérée et validée
    // cliniquement (medical-domain-validator).
    expect(GLYCEMIA_THRESHOLDS_MGDL).toEqual({
      CRITICAL_LOW: 40,
      SEVERE_HYPO: 54,
      TARGET_LOW: 70,
      TARGET_HIGH: 180,
      SEVERE_HYPER: 250,
      CRITICAL_HIGH: 400,
    })
  })

  it("charts/types.DEFAULT_THRESHOLDS dérive de la source (pas de copie)", () => {
    const G = GLYCEMIA_THRESHOLDS_MGDL
    expect(CHART_DEFAULTS).toEqual({
      criticalLow: G.CRITICAL_LOW,
      veryLow: G.SEVERE_HYPO,
      low: G.TARGET_LOW,
      targetMin: G.TARGET_LOW,
      targetMax: G.TARGET_HIGH,
      high: G.SEVERE_HYPER,
      veryHigh: G.CRITICAL_HIGH,
      criticalHigh: G.CRITICAL_HIGH,
    })
  })

  it("aucune régression de magie : les composants glycémie importent la source", () => {
    // Garde structurel léger : si un composant ré-hardcode les seuils au lieu
    // d'importer la source, ce test signale le risque de drift.
    const files = [
      "src/components/diabeo/CgmChart.tsx",
      "src/components/diabeo/GlycemiaValue.tsx",
      "src/components/diabeo/AgpPercentileChart.tsx",
      "src/components/diabeo/charts/types.ts",
    ]
    for (const f of files) {
      const src = readFileSync(f, "utf8")
      expect(src, `${f} doit importer glycemia-thresholds`).toContain(
        "@/lib/glycemia-thresholds",
      )
    }
  })
})
