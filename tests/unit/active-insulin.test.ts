/**
 * Tests — US-2663 (S3d) : prédicat « insuline ACTIVE » (`activeInsulinFilter`, `src/lib/insulin/active-insulin.ts`).
 *
 * Seuil SAFETY-CRITICAL (verrou anti-drift, exigence CLAUDE.md) : ce prédicat décide si une dose fixe est
 * lue/proposée/écrite ou ignorée. On verrouille la FORME du `where` Prisma produit et le calcul du `cutoff`
 * (`endDate > now − 1 jour` ⇔ une insuline finissant AUJOURD'HUI reste active tout le jour ; hier = exclue),
 * miroir exact de la garde d'affichage `treatment-view.ts`. `now` est injecté → test déterministe.
 */
import { describe, it, expect } from "vitest"
import { activeInsulinFilter, DAY_MS } from "@/lib/insulin/active-insulin"

describe("activeInsulinFilter", () => {
  const now = new Date("2026-07-13T18:00:00.000Z")

  it("impose isActive: true (une insuline désactivée est exclue)", () => {
    expect(activeInsulinFilter(now).isActive).toBe(true)
  })

  it("inclut endDate NULL (en cours) OU endDate > now − 1 jour (cutoff exact)", () => {
    const where = activeInsulinFilter(now)
    const cutoff = new Date(now.getTime() - DAY_MS) // 2026-07-12T18:00:00Z
    expect(where.OR).toEqual([{ endDate: null }, { endDate: { gt: cutoff } }])
  })

  it("le cutoff garde une insuline finissant AUJOURD'HUI et exclut hier (date-only minuit)", () => {
    const { OR } = activeInsulinFilter(now)
    const cutoff = (OR as [unknown, { endDate: { gt: Date } }])[1].endDate.gt
    const endsToday = new Date("2026-07-13T00:00:00.000Z") // @db.Date minuit du jour
    const endedYesterday = new Date("2026-07-12T00:00:00.000Z")
    expect(endsToday.getTime() > cutoff.getTime()).toBe(true) // finit aujourd'hui → ACTIF
    expect(endedYesterday.getTime() > cutoff.getTime()).toBe(false) // fini hier → INACTIF
  })

  it("DAY_MS = 86 400 000 (invariant partagé avec treatment-view)", () => {
    expect(DAY_MS).toBe(86_400_000)
  })
})
