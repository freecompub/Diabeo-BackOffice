/**
 * @vitest-environment node
 */

/**
 * US-2269 — Gate anti-drift du design system.
 *
 * Garantit que le miroir TypeScript `src/design-system/tokens.ts`
 * ({@link COLOR_TOKEN_CSS}) reste STRICTEMENT synchrone avec la source CSS
 * `src/styles/tokens.css` (variables `--diabeo-*`). Toute couleur modifiée dans
 * l'un sans l'autre fait échouer la CI — même esprit que `clinical-bounds.test.ts`.
 *
 * Comportement « clinique » couvert : les couleurs glycémie/TIR (sévérité d'un
 * état patient) ne doivent jamais diverger entre la doc/CSS et le code des
 * graphes — un vert/rouge incohérent induirait le praticien en erreur.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"
import { COLOR_TOKEN_CSS } from "@/design-system/tokens"

/** Parse `src/styles/tokens.css` → map `--diabeo-<name>` (UPPER hex). */
function readCssTokens(): Record<string, string> {
  const css = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8")
  const map: Record<string, string> = {}
  const re = /--diabeo-([\w-]+):\s*(#[0-9A-Fa-f]{3,8})\s*;/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    map[m[1]] = m[2].toUpperCase()
  }
  return map
}

describe("design tokens — parité tokens.ts ↔ tokens.css", () => {
  const cssTokens = readCssTokens()

  it("la source CSS expose bien des tokens couleur", () => {
    expect(Object.keys(cssTokens).length).toBeGreaterThan(20)
    expect(cssTokens["primary-600"]).toBe("#0D9488")
  })

  it("chaque token TS correspond EXACTEMENT à la variable CSS --diabeo-* (TS → CSS)", () => {
    const mismatches: string[] = []
    for (const [name, hex] of Object.entries(COLOR_TOKEN_CSS)) {
      const cssHex = cssTokens[name]
      if (cssHex === undefined) {
        mismatches.push(`${name}: absent de tokens.css`)
      } else if (cssHex !== hex.toUpperCase()) {
        mismatches.push(`${name}: tokens.ts=${hex.toUpperCase()} ≠ tokens.css=${cssHex}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it("chaque variable CSS couleur a un pendant dans tokens.ts (CSS → TS, anti-drift inverse)", () => {
    // `cssTokens` ne contient QUE les variables `--diabeo-*` à valeur hex (le
    // regex filtre déjà sur `#...`) → toute couleur ajoutée côté CSS sans miroir
    // TS est détectée ici. (Les tokens non-couleur — spacing, radius… — n'ont
    // pas de valeur hex et ne sont donc pas concernés.)
    const missingInTs = Object.keys(cssTokens).filter((name) => !(name in COLOR_TOKEN_CSS))
    expect(missingInTs).toEqual([])
  })

  it("couvre les couleurs cliniques critiques (glycémie + TIR)", () => {
    for (const k of [
      "glycemia-normal",
      "glycemia-critical",
      "tir-in-range",
      "tir-very-low",
    ] as const) {
      expect(COLOR_TOKEN_CSS[k]).toBeDefined()
      expect(cssTokens[k]).toBe(COLOR_TOKEN_CSS[k].toUpperCase())
    }
  })
})
