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

import { recentOutOfRangeFrom } from "@/lib/cgm-freshness"

// Types de vue dans un module neutre (US-2632) : ré-exportés pour les
// consommateurs (`PatientRecord`, `ReviewClient`, tests), et importés ci-dessous
// par le builder. Sens de dépendance app→components.
export type {
  LatestRawSignal, CgmEntryLite, GlycemiaView,
} from "@/components/diabeo/patient/patient-record-views"
import type {
  LatestRawSignal, CgmEntryLite, GlycemiaView,
} from "@/components/diabeo/patient/patient-record-views"

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

  return {
    points,
    lastReadingMgdl: last ? toMgdl(last.valueGl) : null,
    lastReadingAt: last ? timeFmt.format(new Date(last.timestamp)) : null,
    lastReadingAgeMin,
    stale: lastReadingAgeMin !== null && lastReadingAgeMin > CGM_STALE_AFTER_MIN,
    // Croisement fraîcheur (source unique `recentOutOfRangeFrom`) : relevé hors
    // plage plus récent que l'affiché (ou aucun relevé affichable) → hypo sévère
    // / capteur masqué.
    recentOutOfRange: recentOutOfRangeFrom(last?.timestamp ?? null, latestRaw),
    outOfDisplayRangeCount: (latestRaw?.belowFloorCount ?? 0) + (latestRaw?.aboveCeilingCount ?? 0),
  }
}
