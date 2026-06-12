/**
 * @vitest-environment jsdom
 *
 * Convention « jamais d'acronyme nu » (US-2117, cf. CLAUDE.md §Acronymes).
 * Couvre :
 *   - complétude du namespace i18n `glossary` dans les 3 langues (FR/EN/AR) ;
 *   - garde anti-régression : aucun acronyme nu dans les valeurs i18n affichées
 *     (hors forme « (CODE) » / « — CODE » / « / CODE ») ;
 *   - exceptions RDV/MAJ totalement remplacés (libellé seul) ;
 *   - rendu du composant <Acronym> (acronyme visible + libellé en aria-label).
 */

import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"
import { ACRONYM_CODES } from "@/components/diabeo/Acronym"

const LOCALES = ["fr", "en", "ar"] as const
type Locale = (typeof LOCALES)[number]

const messages = Object.fromEntries(
  LOCALES.map((l) => [
    l,
    JSON.parse(readFileSync(resolve(process.cwd(), "messages", `${l}.json`), "utf8")),
  ]),
) as Record<Locale, Record<string, unknown>>

/** Parcourt toutes les valeurs string d'un objet i18n, en sautant `glossary`. */
function collectStrings(obj: Record<string, unknown>): string[] {
  const out: string[] = []
  const walk = (x: unknown) => {
    if (typeof x === "string") out.push(x)
    else if (x && typeof x === "object") for (const v of Object.values(x)) walk(v)
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === "glossary") continue
    walk(v)
  }
  return out
}

describe("glossary — complétude i18n (3 langues)", () => {
  for (const locale of LOCALES) {
    it(`${locale} : un libellé pour chaque AcronymCode`, () => {
      const glossary = (messages[locale].glossary ?? {}) as Record<string, string>
      for (const code of ACRONYM_CODES) {
        expect(glossary[code], `${locale}.glossary.${code} manquant`).toBeTruthy()
      }
    })
  }
})

describe("garde anti-acronyme nu (valeurs i18n affichées)", () => {
  // GDPR = variante anglaise de RGPD (affichée en EN).
  const SCAN = [...ACRONYM_CODES, "GDPR"]

  for (const locale of LOCALES) {
    it(`${locale} : aucun acronyme nu`, () => {
      const offenders: string[] = []
      for (const value of collectStrings(messages[locale])) {
        for (const code of SCAN) {
          const re = new RegExp(`\\b${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
          if (!re.test(value)) continue
          const ok =
            value.includes(`(${code})`) ||
            value.includes(`— ${code}`) ||
            value.includes(`/ ${code}`)
          if (!ok) offenders.push(`[${code}] ${value}`)
        }
      }
      expect(offenders, `acronymes nus:\n${offenders.join("\n")}`).toEqual([])
    })
  }
})

describe("exceptions — RDV/MAJ remplacés par le libellé seul", () => {
  for (const locale of LOCALES) {
    it(`${locale} : ni "RDV" ni "MAJ" nus`, () => {
      const offenders = collectStrings(messages[locale]).filter((v) =>
        /\b(RDV|MAJ)\b/.test(v),
      )
      expect(offenders).toEqual([])
    })
  }
})

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) =>
    (({ TIR: "Temps dans la cible" }) as Record<string, string>)[k] ?? k,
}))

describe("<Acronym>", () => {
  it("affiche l'acronyme + le libellé complet (aria-label)", async () => {
    const { render, screen } = await import("@testing-library/react")
    const { Acronym } = await import("@/components/diabeo/Acronym")

    render(<Acronym code="TIR" />)

    const trigger = screen.getByRole("button")
    expect(trigger.textContent).toBe("TIR")
    expect(trigger.getAttribute("aria-label")).toBe("Temps dans la cible (TIR)")
  })
})
