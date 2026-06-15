/**
 * Mapping pur (testable) de la série CGM vers la vue dossier patient (Phase 2).
 *
 * Aucune dépendance RSC/Prisma → unit-testable. Transformations déterministes :
 *  - valueGl (g/L) → mg/dL (×100, arrondi entier) ;
 *  - horodatage → « HH:MM » Europe/Paris (rendu serveur, pas de mismatch hydratation) ;
 *  - âge du dernier relevé + drapeau `stale` (fraîcheur : un relevé ancien ne
 *    reflète pas l'état actuel — sécurité clinique, revue PR #544).
 */

/** Seuil de fraîcheur du « dernier relevé » (minutes). Au-delà → `stale`. */
export const CGM_STALE_AFTER_MIN = 30

export type CgmEntryLite = { valueGl: number | null; timestamp: string }

/**
 * Signal de fraîcheur « brut » : relevé CGM le plus récent dans la fenêtre, AVANT
 * le filtre de plage capteur (cf. `glycemiaService.getLatestCgmFreshness`).
 * Permet de détecter qu'un relevé plus récent que l'affiché est hors plage.
 */
export type LatestRawSignal = { timestamp: string; belowFloor: boolean; aboveCeiling: boolean }

export type GlycemiaView = {
  points: { time: string; glucose: number }[]
  lastReadingMgdl: number | null
  lastReadingAt: string | null
  /** Âge du dernier relevé en minutes (null si aucun relevé). */
  lastReadingAgeMin: number | null
  /** Dernier relevé plus ancien que {@link CGM_STALE_AFTER_MIN}. */
  stale: boolean
  /**
   * Un relevé PLUS RÉCENT que celui affiché est hors plage affichable et a donc
   * été exclu de la série : `"low"` (< 40 mg/dL — hypo sévère possible / capteur
   * LOW) ou `"high"` (> 500 mg/dL — capteur HIGH). `null` sinon. Sécurité
   * clinique : évite qu'un relevé bénin plus ancien masque une hypo sévère
   * récente sans signal.
   */
  recentOutOfRange: "low" | "high" | null
}

// Invariant : TZ + locale FIXES (heure clinique FR). Instancié une fois au
// chargement du module pour la perf + le déterminisme serveur. Ne pas rendre
// dépendant de l'utilisateur sans déplacer l'instanciation dans la fonction
// (sinon ce singleton servirait la mauvaise zone).
const timeFmt = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Paris",
  hour12: false,
})

const toMgdl = (gl: number): number => Math.round(gl * 100)

export function buildGlycemiaView(
  entries: CgmEntryLite[],
  now: Date,
  latestRaw?: LatestRawSignal | null,
): GlycemiaView {
  // valueGl null déjà exclu par la requête (CHECK gte/lte) — on borne le type.
  const valid = entries.filter((e): e is CgmEntryLite & { valueGl: number } => e.valueGl !== null)
  const points = valid.map((e) => ({
    time: timeFmt.format(new Date(e.timestamp)),
    glucose: toMgdl(e.valueGl),
  }))
  const last = valid.length > 0 ? valid[valid.length - 1]! : null
  const lastReadingAgeMin = last
    ? Math.max(0, Math.round((now.getTime() - new Date(last.timestamp).getTime()) / 60_000))
    : null

  // Croisement fraîcheur : si le relevé brut le plus récent est hors plage ET
  // plus récent que le dernier relevé affiché (ou s'il n'y a aucun relevé
  // affichable), on signale l'hypo sévère / capteur LOW-HIGH masqué.
  let recentOutOfRange: "low" | "high" | null = null
  if (latestRaw && (latestRaw.belowFloor || latestRaw.aboveCeiling)) {
    const lastShownMs = last ? new Date(last.timestamp).getTime() : Number.NEGATIVE_INFINITY
    if (new Date(latestRaw.timestamp).getTime() > lastShownMs) {
      recentOutOfRange = latestRaw.belowFloor ? "low" : "high"
    }
  }

  return {
    points,
    lastReadingMgdl: last ? toMgdl(last.valueGl) : null,
    lastReadingAt: last ? timeFmt.format(new Date(last.timestamp)) : null,
    lastReadingAgeMin,
    stale: lastReadingAgeMin !== null && lastReadingAgeMin > CGM_STALE_AFTER_MIN,
    recentOutOfRange,
  }
}
