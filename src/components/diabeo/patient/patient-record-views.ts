/**
 * DTO de vue de la fiche patient — types **purs** (aucun runtime, aucune
 * dépendance Prisma/RSC). Source de vérité partagée par le composant
 * présentational `PatientRecord` (et les futurs adaptateurs page/drawer) ET les
 * builders serveur co-localisés à la route (`glycemia-view` / `treatment-view`
 * / `document-view`), qui ré-exportent ces types.
 *
 * Sens de dépendance : `app/ → components/` (les builders importent leurs types
 * d'ici), jamais l'inverse — `PatientRecord` reste autoportant (US-2632).
 */

import type { LatestRawSignal } from "@/lib/cgm-freshness"
export type { LatestRawSignal }

// ── Drapeaux d'alerte « Ma journée » ─────────────────────────────────────────
/**
 * Drapeaux d'alerte sérialisables (miroir de `PatientFlags` serveur). Logé ici
 * (module neutre) plutôt que dans `PatientContextBar` pour casser le cycle de
 * type `PatientContextBar` ↔ `PatientAlertFlags` (US-2633).
 */
export type ContextFlags = {
  recentHypos: boolean
  hypoCount: number
  silentMonitoring: boolean
  silentDays: number | null
  openUrgency: boolean
}

// ── Glycémie (série CGM) ─────────────────────────────────────────────────────
export type CgmEntryLite = { valueGl: number | null; timestamp: string }

export type GlycemiaView = {
  points: { time: string; glucose: number }[]
  lastReadingMgdl: number | null
  lastReadingAt: string | null
  /** Âge du dernier relevé en minutes (null si aucun relevé). */
  lastReadingAgeMin: number | null
  /** Dernier relevé plus ancien que `CGM_STALE_AFTER_MIN`. */
  stale: boolean
  /**
   * Un relevé PLUS RÉCENT que celui affiché est hors plage affichable et a donc
   * été exclu de la série : `"low"` (< 40 mg/dL — hypo sévère possible / capteur
   * LOW) ou `"high"` (> 500 mg/dL — capteur HIGH). `null` sinon. Sécurité
   * clinique : évite qu'un relevé bénin plus ancien masque une hypo sévère
   * récente sans signal.
   */
  recentOutOfRange: "low" | "high" | null
  /**
   * Nombre de relevés de la fenêtre exclus de la série affichée (hors plancher
   * 0.40 / plafond 5.00) mais **comptés dans les statistiques** (TIR/moyenne) —
   * annotation graphe pour réconcilier la courbe et le TIR.
   */
  outOfDisplayRangeCount: number
}

// ── Traitements (insulinothérapie) ──────────────────────────────────────────
export type InsulinDelivery = "pump" | "manual"

/**
 * Garde-fou structurel (PAS clinique) sur la couverture horaire d'une famille
 * de créneaux : trous (heures non couvertes) et chevauchements (≥ 2 créneaux).
 */
export type SlotCoverage = {
  /** Au moins une minute de la journée n'est couverte par aucun créneau. */
  hasGap: boolean
  /** Au moins deux créneaux se recouvrent. */
  hasOverlap: boolean
}

export type Slot = { range: string; value: number }
export type BasalSlot = { range: string; rate: number }
export type TreatmentItem = { id: number; name: string | null; posology: string | null }
/** Insuline bolus active (nom commercial du catalogue + DCI + posologie). */
export type BolusInsulin = { name: string; genericName: string; dosage: string | null }
/** Pompe à insuline active (libellé « marque modèle » + fraîcheur de synchro). */
export type Pump = { label: string; syncStale: boolean }

export type TreatmentView = {
  hasSettings: boolean
  deliveryMethod: InsulinDelivery | null
  bolusInsulin: BolusInsulin | null
  /**
   * FK insuline bolus renseignée mais l'enregistrement lié n'est pas affichable
   * comme bolus actif (inactif / terminé / usage non-bolus) → incohérence de
   * données à signaler. Indice non bloquant côté UI.
   */
  bolusInconsistent: boolean
  pump: Pump | null
  isfSlots: Slot[] // g/L/U
  isfCoverage: SlotCoverage
  icrSlots: Slot[] // g/U
  icrCoverage: SlotCoverage
  basalSlots: BasalSlot[] // U/h (pompe)
  basalCoverage: SlotCoverage
  treatments: TreatmentItem[]
}

// ── Documents médicaux ──────────────────────────────────────────────────────
export type DocSize = { value: number; unitKey: "sizeBytes" | "sizeKb" | "sizeMb" } | null

export type DocumentItem = {
  id: number
  title: string
  category: string | null
  dateIso: string
  size: DocSize
}
