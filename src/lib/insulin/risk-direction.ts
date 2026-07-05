/**
 * US-2649b — Direction de risque clinique d'une proposition d'ajustement (fonction PURE).
 *
 * Surface au médecin (revue) le SENS du risque plutôt que de le masquer derrière un cap
 * (finding clinique US-2649a) : une proposition « direction hypo » (plus d'insuline
 * effective) est la plus aiguë et doit être visible d'un coup d'œil.
 *
 * Sens « plus d'insuline » (→ risque hypo) :
 *  - `basalRate` / `fixedDose` : **hausse** (plus de débit/dose) ;
 *  - `insulinSensitivityFactor` (ISF) : **baisse** (correction = (bg−cible)/ISF ↑) ;
 *  - `insulinToCarbRatio` (ICR) : **baisse** (plus d'insuline par gramme).
 * Sens inverse → risque hyper. Aucun écart → `none`.
 *
 * Module sans dépendance (types Prisma non requis) → importable partout.
 */
export type RiskDirection = "hypo" | "hyper" | "none"

export function deriveRiskDirection(
  parameterType: string,
  currentValue: number,
  proposedValue: number,
): RiskDirection {
  const delta = proposedValue - currentValue
  if (delta === 0 || !Number.isFinite(delta)) return "none"
  // « Plus d'insuline » = hausse basale/dose fixe, OU baisse ISF/ICR.
  const moreInsulin =
    parameterType === "basalRate" || parameterType === "fixedDose" ? delta > 0 : delta < 0
  return moreInsulin ? "hypo" : "hyper"
}
