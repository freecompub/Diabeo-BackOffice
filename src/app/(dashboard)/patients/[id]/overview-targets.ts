/**
 * Résolution de la plage cible glycémique affichée sur le dossier (badge).
 *
 * ⚠️ SERVEUR UNIQUEMENT — importe `objectives.service` (→ Prisma). Ne JAMAIS
 * importer ce module depuis un composant client (fuite de bundle).
 *
 * Invariant clé : la borne haute affichée = **`cgm.ok`** (plafond TIR utilisé
 * par `computeTir`), PAS `cgm.high` (seuil hyper sévère). Sinon le badge
 * diverge du donut/TIR (revue PR #550). À défaut d'objectif CGM, défauts
 * pathology-aware (`getCgmDefaults` : GD 63–140, sinon 70–180). g/L → mg/dL.
 */

import type { Pathology } from "@prisma/client"
import { getCgmDefaults } from "@/lib/services/objectives.service"
import { GLYCEMIA_THRESHOLDS_MGDL } from "@/lib/glycemia-thresholds"

type DecimalLike = number | string | { toString(): string }

export function resolveTargetRangeMgdl(
  cgm: { low: DecimalLike; ok: DecimalLike } | null | undefined,
  pathology?: Pathology | null,
): { targetLowMgdl: number; targetHighMgdl: number } {
  const defaults = getCgmDefaults(pathology ?? undefined)
  const rawLow = Math.round(Number(cgm?.low ?? defaults.low) * 100)
  // `.ok` = plafond TIR (cohérent avec computeTir/analytics), pas `.high`.
  const rawHigh = Math.round(Number(cgm?.ok ?? defaults.ok) * 100)
  // Défense en profondeur : garder la cible strictement dans les zones sévères
  // (54 < low < high < 250) pour que la pastille `GlycemiaValue` ne dégénère pas.
  const targetLowMgdl = Math.min(
    Math.max(rawLow, GLYCEMIA_THRESHOLDS_MGDL.SEVERE_HYPO + 1),
    GLYCEMIA_THRESHOLDS_MGDL.SEVERE_HYPER - 2,
  )
  const targetHighMgdl = Math.min(
    Math.max(rawHigh, targetLowMgdl + 1),
    GLYCEMIA_THRESHOLDS_MGDL.SEVERE_HYPER - 1,
  )
  return { targetLowMgdl, targetHighMgdl }
}
