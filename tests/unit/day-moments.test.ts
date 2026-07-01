/** Tests — `@/lib/day-moments` (rattachement heure → moment, source unique). */
import { describe, it, expect } from "vitest"
import { momentForHour, momentBoundsFrom, DEFAULT_MOMENT_BOUNDS } from "@/lib/day-moments"

describe("momentForHour (défauts)", () => {
  it("mappe les heures aux moments (intervalles demi-ouverts)", () => {
    expect(momentForHour(8)).toBe("morning") // [4,10)
    expect(momentForHour(13)).toBe("noon") // [10,16)
    expect(momentForHour(18)).toBe("evening") // [16,22)
    expect(momentForHour(23)).toBe("night") // 22→4 (passage minuit)
    expect(momentForHour(2)).toBe("night")
    expect(momentForHour(4)).toBe("morning") // borne basse incluse
    expect(momentForHour(10)).toBe("noon") // borne haute exclue
  })
})

describe("momentBoundsFrom", () => {
  it("surcharge les bornes par défaut avec les UserDayMoment (heure murale) et ignore custom", () => {
    const t = (h: number) => new Date(Date.UTC(1970, 0, 1, h, 0))
    const bounds = momentBoundsFrom([
      { type: "morning", startTime: t(5), endTime: t(11) },
      { type: "custom", startTime: t(0), endTime: t(1) }, // ignoré
    ])
    expect(bounds.morning).toEqual({ start: 5, end: 11 })
    expect(bounds.noon).toEqual(DEFAULT_MOMENT_BOUNDS.noon) // inchangé
    // Une heure de 5 tombe désormais dans « morning » (au lieu de « night »).
    expect(momentForHour(5, bounds)).toBe("morning")
  })
})
