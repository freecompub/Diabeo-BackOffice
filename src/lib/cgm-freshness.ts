/**
 * Croisement de fraîcheur CGM (sécurité clinique) — module pur, sans dépendance.
 *
 * `getCgmEntries` exclut les valeurs hors plage capteur (< 0.40 g/L = hypo
 * sévère possible / capteur LOW, > 5.00 g/L = capteur HIGH). Un relevé hors
 * plage RÉCENT peut donc laisser un relevé bénin plus ancien passer pour le
 * « dernier relevé » sans déclencher `stale` → fausse réassurance.
 *
 * Source unique du croisement (réutilisé par le dossier médecin, le dashboard
 * patient et les routes API — header `X-CGM-Recent-Out-Of-Range`).
 */

/**
 * Relevé CGM le plus récent dans la fenêtre, AVANT filtre de plage (cf.
 * `glycemiaService.getLatestCgmFreshness`).
 */
export type LatestRawSignal = { timestamp: string; belowFloor: boolean; aboveCeiling: boolean }

/** Header HTTP exposant le signal (valeurs `"low"`/`"high"`/`"none"`). */
export const CGM_RECENT_OOR_HEADER = "X-CGM-Recent-Out-Of-Range"

/**
 * Détermine si un relevé hors plage est PLUS RÉCENT que le dernier relevé
 * affiché (ou s'il n'y a aucun relevé affichable) → signal d'hypo sévère /
 * capteur masqué. `null` sinon.
 *
 * @param lastShownIso horodatage ISO du dernier relevé affichable (null si aucun)
 * @param latestRaw relevé brut le plus récent (hors filtre de valeur)
 */
export function recentOutOfRangeFrom(
  lastShownIso: string | null,
  latestRaw: LatestRawSignal | null | undefined,
): "low" | "high" | null {
  if (!latestRaw || (!latestRaw.belowFloor && !latestRaw.aboveCeiling)) return null
  const lastShownMs = lastShownIso ? new Date(lastShownIso).getTime() : Number.NEGATIVE_INFINITY
  if (new Date(latestRaw.timestamp).getTime() > lastShownMs) {
    return latestRaw.belowFloor ? "low" : "high"
  }
  return null
}
