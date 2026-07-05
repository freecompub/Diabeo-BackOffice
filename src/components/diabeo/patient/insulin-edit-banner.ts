/**
 * US-2648b — Logique d'affichage du bandeau d'édition insuline (fonction PURE).
 *
 * Traduit un `InsulinEditCapability` (mode + capacités + `blockedReason`) en clés
 * i18n à afficher dans l'onglet Traitements, en portant les AC UI de la revue
 * clinique (PR #645) :
 *  - config incohérente → message « à revoir » + indice « corriger » SI le rôle peut
 *    écrire en direct (chemin de réparation DOCTOR, hors gate de cohérence) ;
 *  - doses fixes → message clinique honnête (« titration via le soignant »), pas « non
 *    éditable » sec ;
 *  - non-insuliné → note explicite (pas d'éditeur d'insuline).
 *
 * Séparé du composant JSX pour être testable sans next-intl.
 */
import type { TreatmentMode } from "@prisma/client"
import type { InsulinEditCapability } from "@/lib/insulin/edit-capability"

/** Clé i18n (namespace `patientDetail`) du libellé de chaque mode de traitement. */
export const MODE_LABEL_KEY: Record<TreatmentMode, string> = {
  basalBolus: "insulinModeBasalBolus",
  fixedDose: "insulinModeFixedDose",
  nonInsulin: "insulinModeNonInsulin",
}

/** Note explicative affichée sous le badge de mode (null = mode éditable, rien à dire). */
export type BannerNote = "incoherentConfig" | "fixedDoseTitration" | "nonInsulin" | null

export type BannerContent = {
  /** Clé i18n du libellé de mode. */
  modeKey: string
  /** Note à afficher (message d'état), ou null. */
  note: BannerNote
  /** Afficher l'indice « corriger la configuration » (incohérence + écriture directe possible). */
  showRepairHint: boolean
}

/**
 * Dérive le contenu du bandeau à partir des capacités.
 * @param cap Capability descriptor (serveur) du patient pour le rôle courant.
 */
export function deriveBannerContent(cap: InsulinEditCapability): BannerContent {
  const modeKey = MODE_LABEL_KEY[cap.mode]

  if (cap.blockedReason === "incoherentConfig") {
    // Ne PAS masquer en cul-de-sac : si le rôle peut réparer en direct, le signaler.
    return { modeKey, note: "incoherentConfig", showRepairHint: cap.canEditDirect }
  }
  if (cap.blockedReason === "modeNotEditable") {
    return {
      modeKey,
      note: cap.mode === "fixedDose" ? "fixedDoseTitration" : "nonInsulin",
      showRepairHint: false,
    }
  }
  // Mode éditable (basalBolus cohérent) → pas de note ; les CTA édition/proposition
  // arrivent au slice suivant (US-2648b forms).
  return { modeKey, note: null, showRepairHint: false }
}
