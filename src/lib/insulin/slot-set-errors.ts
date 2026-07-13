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
  // Patient NON pompe (MDI) : refus d'attacher des créneaux basaux pompe (intégrité du mode de délivrance).
  basalConfigNotPump: 409,
  // US-2663 (S3b-0a) — proposition MOTEUR sans rationale par créneau (contrat serveur, ne vient jamais d'un input humain).
  rationaleRequired: 422,
  invalidProposerIdentity: 422, // US-2663 S3b-0a — parité algorithme⇔userId null (contrat serveur)
  // US-2663 (S3d) — voie groupée DOSE FIXE (`replaceFixedDoseSet`) : créneau (usage, moment) introuvable
  // (dose supprimée depuis la génération → régénérer, 409) ou AMBIGU (deux `PatientInsulin` de même usage
  // portant ce moment → désambiguïser le profil, 422 non résoluble par régénération).
  fixedDoseSlotNotFound: 409,
  fixedDoseSlotAmbiguous: 422,
  unsupportedSlotSetParam: 422, // levier non géré par l'acceptation groupée (fail-closed)
}
