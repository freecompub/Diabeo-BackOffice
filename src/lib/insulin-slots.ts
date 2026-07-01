/**
 * Sélection de créneau horaire ISF/ICR/basal — **source de vérité unique**
 * (ADR #11). Fonction PURE, sans dépendance Prisma/serveur → importable côté
 * client comme serveur (calcul de bolus `insulin.service`, annotation de ratio
 * des tendances de repas US-2637).
 *
 * Intervalle demi-ouvert `[startHour, endHour)`, passage minuit géré. **Aucun
 * fallback** : une heure non couverte renvoie `undefined` (fail-closed — cf.
 * calcul de bolus qui lève alors « No ISF/ICR slot found for current hour »).
 */
export function findSlotForHour<T extends { startHour: number; endHour: number }>(
  slots: T[],
  hour: number,
): T | undefined {
  return slots.find((s) =>
    s.startHour <= s.endHour
      ? hour >= s.startHour && hour < s.endHour // intervalle normal
      : hour >= s.startHour || hour < s.endHour, // passage minuit (22h → 6h)
  )
}
