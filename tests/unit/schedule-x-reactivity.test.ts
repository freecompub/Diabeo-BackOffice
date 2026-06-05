// @vitest-environment jsdom
/**
 * Régression #477 (§8) + #478 (§10) — réactivité Schedule-X (preact-signals).
 *
 * Root cause : `@preact/signals@2.x` exige `preact >= 10.25.0` ; une résolution
 * basse (10.24.3) cassait silencieusement la réactivité signals → les mises à
 * jour pilotées par signal de Schedule-X ne se propageaient plus :
 *   - le sélecteur de vue ne s'ouvrait pas (classe `is-open` jamais ajoutée) — §8
 *   - l'axe horaire de la vue Semaine restait vide (aucun `hour-text`) — §10
 *
 * Garde-fou : si un futur `pnpm install` ré-abaisse preact < 10.25.0 (override
 * retiré dans package.json), ce test échoue. Il rend la vue Schedule-X v4 dans
 * jsdom (avec stubs ResizeObserver/getBoundingClientRect que le navigateur
 * fournit nativement) et vérifie que les deux comportements signal fonctionnent.
 */
import { describe, it, expect, beforeAll } from "vitest"
import "temporal-polyfill/global"

describe("Schedule-X v4 reactivity (preact-signals) — #477/#478 regression", () => {
  beforeAll(() => {
    // Le navigateur fournit ces APIs ; jsdom non. Schedule-X mesure le conteneur
    // (ResizeObserver + getBoundingClientRect) pour calculer la grille horaire.
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      private cb: (entries: unknown[], obs: unknown) => void
      constructor(cb: (entries: unknown[], obs: unknown) => void) { this.cb = cb }
      observe(target: Element) {
        this.cb([{ target, contentRect: { width: 900, height: 640, top: 0, left: 0, right: 900, bottom: 640 } }], this)
      }
      unobserve() {}
      disconnect() {}
    }
    if (!window.matchMedia) {
      ;(window as unknown as { matchMedia: unknown }).matchMedia = () => ({
        matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      })
    }
    Element.prototype.getBoundingClientRect = function () {
      return { width: 900, height: 640, top: 0, left: 0, right: 900, bottom: 640, x: 0, y: 0, toJSON() {} } as DOMRect
    }
  })

  it("week view time-axis renders hour labels and the view selector opens on click", async () => {
    const { createCalendar, createViewWeek, createViewDay, createViewMonthGrid } =
      (await import("@schedule-x/calendar")) as unknown as {
        createCalendar: (cfg: unknown) => { render: (el: Element) => void }
        createViewWeek: () => { name: string }
        createViewDay: () => unknown
        createViewMonthGrid: () => unknown
      }

    const el = document.createElement("div")
    document.body.appendChild(el)
    const week = createViewWeek()
    createCalendar({
      views: [createViewMonthGrid(), week, createViewDay()],
      defaultView: week.name,
      events: [],
    }).render(el)
    await new Promise((r) => setTimeout(r, 120))

    // §10 — l'axe horaire est peuplé (24 heures par défaut).
    const hourTexts = el.querySelectorAll(".sx__week-grid__hour-text")
    expect(hourTexts.length).toBeGreaterThan(0)

    // §8 — cliquer le bouton de sélection de vue ajoute `is-open` (signal réactif).
    const selBtn = el.querySelector(".sx__view-selection-selected-item") as HTMLElement
    expect(selBtn).toBeTruthy()
    selBtn.click()
    await new Promise((r) => setTimeout(r, 40))
    expect(el.querySelector(".sx__view-selection")?.className).toContain("is-open")
    expect(el.querySelectorAll(".sx__view-selection-item").length).toBeGreaterThan(0)
  })
})
