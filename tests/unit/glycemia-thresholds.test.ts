/**
 * Garde anti-drift des seuils glycémiques (US-2117 suite).
 *
 * Comportement clinique testé : les seuils d'affichage glycémiques (zones
 * hypo/cible/hyper) ont UNE seule source de vérité (`glycemia-thresholds.ts`).
 * Risque associé : une copie divergente (cf. le drift ISF/ICR corrigé sur la
 * page insulinothérapie) ferait afficher des zones erronées à des seuils
 * différents selon le composant — confusion clinique potentielle.
 *
 * Ce test (1) fige les valeurs de consensus — tout changement devient explicite
 * en revue —, et (2) vérifie que CHAQUE forme consommatrice **dérive réellement**
 * de la source : dérivation d'objet (charts/types) ET dérivation de comportement
 * (GlycemiaValue.getGlycemiaZone, dont les bornes par défaut doivent coller à la
 * source). Pas de scan d'import (contournable) : on teste l'usage effectif.
 */

import { describe, it, expect } from "vitest"
import { GLYCEMIA_THRESHOLDS_MGDL as G } from "@/lib/glycemia-thresholds"
import { DEFAULT_THRESHOLDS as CHART_DEFAULTS } from "@/components/diabeo/charts/types"
import { getGlycemiaZone } from "@/components/diabeo/GlycemiaValue"

describe("glycemia-thresholds — source de vérité", () => {
  it("fige les seuils de consensus ADA/ATTD (mg/dL)", () => {
    // Toute modification de ces valeurs doit être délibérée et validée
    // cliniquement (medical-domain-validator).
    expect(G).toEqual({
      CRITICAL_LOW: 40,
      SEVERE_HYPO: 54,
      TARGET_LOW: 70,
      TARGET_HIGH: 180,
      SEVERE_HYPER: 250,
      CRITICAL_HIGH: 400,
    })
  })

  it("charts/types.DEFAULT_THRESHOLDS dérive de la source (pas de copie)", () => {
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

  it("GlycemiaValue.getGlycemiaZone classe aux bornes de la source (dérivation de comportement)", () => {
    // Les bornes par défaut de GlycemiaValue doivent coller à la source : on
    // sonde de part et d'autre de chaque seuil. Un re-hardcode divergent (ex.
    // veryLow=50 au lieu de 54) ferait échouer ces assertions.
    expect(getGlycemiaZone(G.SEVERE_HYPO - 1)).toBe("very-low") // < 54
    expect(getGlycemiaZone(G.SEVERE_HYPO)).toBe("low") // 54 → hypo niveau 1
    expect(getGlycemiaZone(G.TARGET_LOW)).toBe("normal") // 70 → cible basse
    expect(getGlycemiaZone(G.TARGET_HIGH)).toBe("normal") // 180 → cible haute
    expect(getGlycemiaZone(G.TARGET_HIGH + 1)).toBe("high") // 181 → hyper niveau 1
    expect(getGlycemiaZone(G.SEVERE_HYPER)).toBe("high") // 250 (limite)
    expect(getGlycemiaZone(G.SEVERE_HYPER + 1)).toBe("very-high") // 251 → hyper niveau 2
    expect(getGlycemiaZone(G.CRITICAL_HIGH)).toBe("very-high") // 400 (limite)
    expect(getGlycemiaZone(G.CRITICAL_HIGH + 1)).toBe("critical") // 401 → danger
  })
})
