/**
 * @module cabinet-time
 * @description Bornes temporelles « jour ouvré » exprimées dans le fuseau du
 * cabinet (Europe/Paris), renvoyées comme instants UTC corrects (DST-aware).
 *
 * Source unique pour le « aujourd'hui » métier : tableau de bord médecin
 * (`doctor-dashboard.service`) et mode revue de consultation
 * (`encounter.service`, US-2605) partagent ces bornes pour rester cohérents.
 *
 * ⚠️ Pourquoi pas `new Date(YYYY-MM-DDT00:00:00Z)` : ce serait minuit UTC de la
 * date locale Paris — décalé du offset Paris→UTC (1h CET / 2h CEST). Pour les
 * colonnes `@db.Timestamptz()` (CgmEntry.timestamp, Encounter.openedAt…) le
 * filtre exclurait alors silencieusement les 1-2 premières heures du jour.
 * On extrait l'offset vif via la partie `longOffset` et on l'injecte dans le
 * littéral ISO pour que JS parse correctement vers UTC.
 */

export const CABINET_TIMEZONE = "Europe/Paris"

/** Parts {year, month, day, offset} de `now` dans le fuseau cabinet. */
function cabinetDateParts(now: Date): { year: string; month: string; day: string; offset: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: CABINET_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    timeZoneName: "longOffset",
  })
  const parts = fmt.formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  // `longOffset` → "GMT+02:00" / "GMT-05:00" ; ISO literal accepts ±HH:MM.
  const offset = get("timeZoneName").replace(/^GMT/, "") || "+00:00"
  return { year: get("year"), month: get("month"), day: get("day"), offset }
}

/** Début du jour courant en TZ cabinet, comme instant UTC. */
export function startOfTodayCabinet(now = new Date()): Date {
  const { year, month, day, offset } = cabinetDateParts(now)
  return new Date(`${year}-${month}-${day}T00:00:00${offset}`)
}

/** Intervalle [start, end) couvrant le jour courant en TZ cabinet, en UTC. */
export function todayBounds(now = new Date()): { start: Date; end: Date } {
  const start = startOfTodayCabinet(now)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}

/**
 * Bornes [start, end) **date-only** du jour calendaire cabinet, pour comparer
 * une colonne `@db.Date` (ex. `Appointment.date`).
 *
 * ⚠️ NE PAS utiliser {@link todayBounds} sur une colonne `@db.Date` : ses
 * bornes sont des `timestamptz` décalés en TZ cabinet (ex. minuit Paris =
 * 22:00Z la veille). Prisma tronque ces valeurs à la date pour comparer une
 * colonne `Date`, ce qui donne `[veille, aujourd'hui)` et **exclut le jour
 * courant** dès que la TZ cabinet est à l'est d'UTC (toujours, à Paris).
 *
 * Ici les bornes sont à **minuit UTC** du jour calendaire cabinet, donc la
 * troncature Prisma rend les bonnes dates : `[aujourd'hui, demain)`.
 */
export function todayDateBounds(now = new Date()): { start: Date; end: Date } {
  const { year, month, day } = cabinetDateParts(now)
  const start = new Date(`${year}-${month}-${day}T00:00:00.000Z`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}
