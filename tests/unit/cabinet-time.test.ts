/**
 * Test suite: cabinet-time bounds (Europe/Paris).
 *
 * Comportement testé : `todayDateBounds()` produit des bornes **date-only**
 * (minuit UTC du jour calendaire cabinet) pour comparer une colonne `@db.Date`
 * (ex. `Appointment.date`), là où `todayBounds()` produit des `timestamptz`
 * décalés en TZ cabinet (corrects pour les colonnes timestamptz).
 *
 * Risque couvert : un RDV du jour n'apparaît pas si la query compare une
 * colonne `@db.Date` avec les bornes timestamptz de `todayBounds()` — Prisma
 * tronque ces bornes à la date et exclut le jour courant dès que la TZ cabinet
 * est à l'est d'UTC (toujours, à Paris). Bug réel des dashboards médecin/infirmier.
 */
import { describe, it, expect } from "vitest"
import { todayBounds, todayDateBounds } from "@/lib/cabinet-time"

/** Date-part comparée par Postgres pour une colonne @db.Date. */
const datePart = (d: Date) => d.toISOString().slice(0, 10)

describe("todayDateBounds (cabinet Europe/Paris)", () => {
  it("renvoie des bornes minuit-UTC du jour calendaire cabinet (été, +02)", () => {
    const now = new Date("2026-06-28T12:00:00Z") // Paris 14:00 → 28 juin
    const { start, end } = todayDateBounds(now)
    expect(start.toISOString()).toBe("2026-06-28T00:00:00.000Z")
    expect(end.toISOString()).toBe("2026-06-29T00:00:00.000Z")
  })

  it("renvoie le bon jour en hiver (+01)", () => {
    const now = new Date("2026-01-15T12:00:00Z") // Paris 13:00 → 15 janv
    expect(todayDateBounds(now).start.toISOString()).toBe("2026-01-15T00:00:00.000Z")
  })

  it("inclut le jour cabinet pour une colonne @db.Date — là où todayBounds l'exclut (le bug)", () => {
    // Soir UTC : Paris a déjà basculé au jour calendaire suivant.
    const now = new Date("2026-06-28T23:30:00Z") // Paris 2026-06-29T01:30 → jour cabinet = 29
    const cabinetToday = "2026-06-29"

    // todayDateBounds : la troncature date inclut bien le jour cabinet.
    const day = todayDateBounds(now)
    expect(datePart(day.start) <= cabinetToday && cabinetToday < datePart(day.end)).toBe(true)

    // todayBounds : bornes timestamptz tronquées → le jour cabinet est EXCLU.
    const tz = todayBounds(now)
    expect(datePart(tz.start) <= cabinetToday && cabinetToday < datePart(tz.end)).toBe(false)
    expect(datePart(tz.start)).toBe("2026-06-28") // start tombe la veille
  })

  it("end vaut exactement start + 24 h", () => {
    const { start, end } = todayDateBounds(new Date("2026-03-10T09:00:00Z"))
    expect(end.getTime() - start.getTime()).toBe(24 * 3600 * 1000)
  })
})
