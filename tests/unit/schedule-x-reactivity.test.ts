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
 * Fix : `pnpm.overrides.preact: ">=10.25.0 <11"` (package.json) → preact@10.29.2.
 * NB : l'override est une range (laisse les patchs de sécu) bornée `<11` car
 * Schedule-X / @preact/signals ne sont pas testés contre preact 11 — à relever
 * lors d'une future migration. L'override touche aussi la dep preact bundlée de
 * `@auth/core` (SSR next-auth), mais c'est inerte ici (next-auth = types only,
 * ADR #16).
 *
 * Deux garde-fous :
 *   1. assertion déterministe sur `preact.version` — échoue immédiatement si
 *      l'override est retiré (le vrai filet anti-régression de package.json) ;
 *   2. rendu fonctionnel de Schedule-X v4 en jsdom (stubs ResizeObserver /
 *      getBoundingClientRect / matchMedia que le navigateur fournit nativement),
 *      vérifiant axe horaire peuplé + sélecteur de vue qui s'ouvre.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import "temporal-polyfill/global"

// preact n'est pas une dep directe (override only) → on lit la version RÉSOLUE
// depuis le lockfile (source de vérité de la CI `--frozen-lockfile`).
// Vitest exécute depuis la racine du repo (process.cwd()).
const LOCKFILE = readFileSync(join(process.cwd(), "pnpm-lock.yaml"), "utf8")

interface CalendarApp {
  render: (el: Element) => void
}
interface ScheduleXModule {
  createCalendar: (cfg: unknown) => CalendarApp
  createViewWeek: () => { name: string }
  createViewDay: () => unknown
  createViewMonthGrid: () => unknown
}

const FAKE_RECT: DOMRect = {
  width: 900, height: 640, top: 0, left: 0, right: 900, bottom: 640, x: 0, y: 0,
  toJSON() { return {} },
}

describe("Schedule-X v4 reactivity (preact-signals) — #477/#478 regression", () => {
  // Garde-fou direct (F4) : si l'override package.json est retiré, le lockfile
  // re-résout preact < 10.25.0 et CETTE assertion échoue de façon déterministe
  // (avant même le rendu jsdom ci-dessous).
  it("every resolved preact in the lockfile satisfies @preact/signals (>= 10.25.0)", () => {
    const versions = [...LOCKFILE.matchAll(/preact@(10\.\d+\.\d+)/g)].map((m) => m[1])
    expect(versions.length).toBeGreaterThan(0)
    for (const v of versions) {
      const minor = Number(v.split(".")[1])
      expect(
        minor,
        `preact ${v} < 10.25.0 → réactivité @preact/signals cassée (#477/#478) — override retiré ?`,
      ).toBeGreaterThanOrEqual(25)
    }
  })

  describe("functional render in jsdom", () => {
    let originalGBCR: typeof Element.prototype.getBoundingClientRect
    let originalRO: typeof globalThis.ResizeObserver | undefined
    let originalMatchMedia: typeof window.matchMedia | undefined

    beforeAll(() => {
      // jsdom ne fournit pas ces APIs. On sauvegarde puis restaure (anti-pollution
      // des autres tests jsdom — F1).
      originalGBCR = Element.prototype.getBoundingClientRect
      originalRO = globalThis.ResizeObserver
      originalMatchMedia = window.matchMedia

      class StubResizeObserver implements ResizeObserver {
        private cb: ResizeObserverCallback
        constructor(cb: ResizeObserverCallback) { this.cb = cb }
        observe(target: Element) {
          this.cb([{ target, contentRect: FAKE_RECT } as ResizeObserverEntry], this)
        }
        unobserve() {}
        disconnect() {}
      }
      globalThis.ResizeObserver = StubResizeObserver
      Element.prototype.getBoundingClientRect = () => FAKE_RECT
      if (!window.matchMedia) {
        window.matchMedia = ((): MediaQueryList => ({
          matches: false, media: "", onchange: null,
          addEventListener() {}, removeEventListener() {},
          addListener() {}, removeListener() {}, dispatchEvent() { return false },
        })) as typeof window.matchMedia
      }
    })

    afterAll(() => {
      Element.prototype.getBoundingClientRect = originalGBCR
      if (originalRO) globalThis.ResizeObserver = originalRO
      else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
      if (originalMatchMedia) window.matchMedia = originalMatchMedia
    })

    it("week view time-axis renders hour labels and the view selector opens on click", async () => {
      const { createCalendar, createViewWeek, createViewDay, createViewMonthGrid } =
        (await import("@schedule-x/calendar")) as unknown as ScheduleXModule

      const el = document.createElement("div")
      document.body.appendChild(el)
      const week = createViewWeek()
      createCalendar({
        views: [createViewMonthGrid(), week, createViewDay()],
        defaultView: week.name,
        events: [],
      }).render(el)

      // §10 — axe horaire peuplé (24h par défaut). Polling (F2) vs setTimeout fixe.
      await waitFor(() => {
        expect(el.querySelectorAll(".sx__week-grid__hour-text").length).toBeGreaterThan(0)
      })

      // §8 — cliquer le sélecteur de vue ajoute `is-open` (signal réactif).
      const selBtn = el.querySelector<HTMLButtonElement>(".sx__view-selection-selected-item")
      expect(selBtn).toBeTruthy()
      selBtn!.click()
      await waitFor(() => {
        expect(el.querySelector(".sx__view-selection")?.className).toContain("is-open")
        expect(el.querySelectorAll(".sx__view-selection-item").length).toBeGreaterThan(0)
      })
    })
  })
})
