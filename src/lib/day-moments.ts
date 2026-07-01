/**
 * Moments de la journée (Nuit / Matin / Midi / Soir) — **source de vérité unique**
 * pour rattacher une heure locale à un moment. Module PUR (sans Prisma) →
 * importable côté client comme serveur (tendances de repas US-2637, carnet BGM
 * US-2639).
 *
 * Les bornes par défaut sont surchargeables par les `UserDayMoment` du patient
 * (heures MURALES locales, colonne `Time` sans fuseau).
 */

export type DayMoment = "morning" | "noon" | "evening" | "night"
export const DAY_MOMENTS: readonly DayMoment[] = ["morning", "noon", "evening", "night"] as const

/** Défauts si le patient n'a pas de `UserDayMoment` : Nuit 22–04 / Matin 04–10 /
 *  Midi 10–16 / Soir 16–22 (bornes en heures locales). */
export const DEFAULT_MOMENT_BOUNDS: Record<DayMoment, { start: number; end: number }> = {
  night: { start: 22, end: 4 },
  morning: { start: 4, end: 10 },
  noon: { start: 10, end: 16 },
  evening: { start: 16, end: 22 },
}

/** Rattache une heure locale (0–24) à un moment via les bornes du patient (ou
 *  défauts). Intervalle demi-ouvert, passage minuit géré ; filet = `night`. */
export function momentForHour(
  hour: number,
  bounds: Record<DayMoment, { start: number; end: number }> = DEFAULT_MOMENT_BOUNDS,
): DayMoment {
  for (const m of DAY_MOMENTS) {
    const { start, end } = bounds[m]
    const inSlot = start <= end ? hour >= start && hour < end : hour >= start || hour < end
    if (inSlot) return m
  }
  return "night" // les 4 moments couvrent 24 h
}

/**
 * Construit les bornes de moment à partir des `UserDayMoment` du patient (chaque
 * `startTime`/`endTime` est un `Time` mural → `getUTCHours()` donne l'heure
 * locale brute). Les types absents retombent sur les défauts ; `custom` ignoré.
 */
export function momentBoundsFrom(
  dayMoments: { type: string; startTime: Date; endTime: Date }[],
): Record<DayMoment, { start: number; end: number }> {
  const bounds = { ...DEFAULT_MOMENT_BOUNDS }
  for (const dm of dayMoments) {
    if (dm.type in bounds) {
      bounds[dm.type as DayMoment] = { start: dm.startTime.getUTCHours(), end: dm.endTime.getUTCHours() }
    }
  }
  return bounds
}
