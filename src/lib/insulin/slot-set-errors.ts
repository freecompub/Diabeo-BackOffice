/**
 * Codes d'erreur métier du remplacement/soumission de jeu de créneaux ISF/ICR → statut HTTP (stables,
 * sans PHI). **Module SANS dépendance** — réutilisé par la voie DOCTOR (`slot-set-replace`) ET la route
 * patient C3c (`api/patient/insulin-slot-set`), sans coupler cette dernière au handler DOCTOR.
 */
export const SLOT_SET_ERROR_STATUS: Record<string, number> = {
  emptySlotSet: 409,
  zeroDurationSlot: 400,
  slotOverlap: 409,
  slotGap: 422,
  valueOutOfBounds: 400,
  settingsNotFound: 404,
  invalidSlotSet: 400, // forme JSON invalide (parseSlots)
  slotsBusy: 409, // mutation concurrente en cours (verrou non bloquant) — réessayer
  // C3c — levées par `createSetProposal` sur la voie fallback proposition (course de double-soumission /
  // bascule MDR concurrente) : à mapper en 4xx, jamais en 500 (cohérent avec `slotsBusy`).
  duplicatePendingProposal: 409,
  nonInsulinNoDose: 409,
  // US-2657 (grouped-only) — voie groupée BASALE (`replacePumpSlotSet`) : débit non délivrable (multiple
  // de l'incrément pompe) et absence de configuration basale.
  rateNotDeliverable: 400,
  basalConfigNotFound: 404,
}
