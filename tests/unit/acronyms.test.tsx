/**
 * @vitest-environment jsdom
 *
 * Convention « jamais d'acronyme nu » (US-2117, cf. CLAUDE.md §Acronymes).
 * Couvre :
 *   - complétude du namespace i18n `glossary` dans les 3 langues (FR/EN/AR) ;
 *   - garde anti-régression PAR OCCURRENCE : chaque occurrence d'un acronyme,
 *     dans les valeurs i18n ET dans le JSX (`.tsx`), doit être explicitée
 *     (forme « (CODE) » / « — CODE » / « / CODE ») ;
 *   - exceptions RDV/MAJ totalement remplacés (libellé seul) ;
 *   - rendu du composant <Acronym> (acronyme visible + libellé en aria-label).
 */

import { describe, it, expect, vi } from "vitest"
import { readFileSync, readdirSync } from "fs"
import { resolve, join } from "path"
import { ACRONYM_CODES } from "@/components/diabeo/Acronym"

const ROOT = process.cwd()
const LOCALES = ["fr", "en", "ar"] as const
type Locale = (typeof LOCALES)[number]

// GDPR = variante anglaise de RGPD ; GMI/percentiles couverts par ACRONYM_CODES.
const SCAN = [...ACRONYM_CODES, "GDPR"]

const messages = Object.fromEntries(
  LOCALES.map((l) => [
    l,
    JSON.parse(readFileSync(resolve(ROOT, "messages", `${l}.json`), "utf8")),
  ]),
) as Record<Locale, Record<string, unknown>>

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Vérifie CHAQUE occurrence de `code` (mot entier) dans `value`. Formes
 * explicitées TOLÉRÉES (sinon = nu) :
 *   - « (CODE) »  : code entre parenthèses (préfixe « ( », suffixe « ) ») ;
 *   - « — CODE »  : code précédé d'un tiret cadratin + espace ;
 *   - « / CODE »  : code précédé d'un slash + espace (ex. « ... / ADA »).
 * Toute autre occurrence (ex. « CODE », « (CODE-7j) », « CODE, ») est NUE.
 * Retourne true si une occurrence nue subsiste.
 */
function hasBareOccurrence(value: string, code: string): boolean {
  const re = new RegExp(`\\b${esc(code)}\\b`, "g")
  let m: RegExpExecArray | null
  while ((m = re.exec(value)) !== null) {
    const before = value.slice(Math.max(0, m.index - 2), m.index)
    const after = value.slice(m.index + code.length, m.index + code.length + 1)
    const wrappedParen = before.endsWith("(") && after === ")"
    const dashForm = before === "— " || before === "/ "
    if (!wrappedParen && !dashForm) return true
  }
  return false
}

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

describe("garde anti-acronyme nu — valeurs i18n (par occurrence)", () => {
  for (const locale of LOCALES) {
    it(`${locale} : aucune occurrence nue`, () => {
      const offenders: string[] = []
      for (const value of collectStrings(messages[locale])) {
        for (const code of SCAN) {
          if (hasBareOccurrence(value, code)) offenders.push(`[${code}] ${value}`)
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

describe("garde anti-acronyme nu — JSX hardcodé (.tsx)", () => {
  // Liste récursive des .tsx sous src/ (hors composant Acronym lui-même).
  function listTsx(dir: string): string[] {
    const out: string[] = []
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) out.push(...listTsx(p))
      else if (e.name.endsWith(".tsx") && e.name !== "Acronym.tsx") out.push(p)
    }
    return out
  }

  /** Neutralise tout ce qui n'est PAS du texte client statique : commentaires
   *  (`/* *\/`, `{/* *\/}`, `//`), expressions JSX `{…}` (itératif → neutralise
   *  les `=>`/`>` du code), et les éléments `<Acronym …>…</Acronym>` (déjà
   *  conformes par construction). Préserve les `\n` pour le calcul de ligne. */
  function stripNonText(src: string): string {
    const blank = (m: string) => m.replace(/[^\n]/g, " ")
    let s = src
      .replace(/\/\*[\s\S]*?\*\//g, blank) // block + JSDoc
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, blank) // {/* */}
      .replace(/\/\/[^\n]*/g, blank) // // ...
      .replace(/<Acronym\b[^>]*\/>/g, blank) // <Acronym ... />
      .replace(/<Acronym\b[\s\S]*?<\/Acronym>/g, blank) // <Acronym>...</Acronym>
    let prev
    do {
      prev = s
      s = s.replace(/\{[^{}]*\}/g, blank) // expressions JSX (itératif)
    } while (s !== prev)
    return s
  }

  it("aucun acronyme nu dans le texte/props JSX (multi-ligne, hors commentaires/expressions)", () => {
    const offenders: string[] = []
    for (const file of listTsx(resolve(ROOT, "src"))) {
      const src = stripNonText(readFileSync(file, "utf8"))
      const segments = [
        // texte JSX entre `>` et `<` (multi-ligne : `[^<>]` matche le `\n`).
        ...[...src.matchAll(/>([^<>]+)</g)].map((m) => ({ seg: m[1], idx: m.index ?? 0 })),
        ...[...src.matchAll(/(?:label|title|placeholder|aria-label)="([^"]*)"/g)].map((m) => ({ seg: m[1], idx: m.index ?? 0 })),
      ]
      for (const { seg, idx } of segments) {
        for (const code of SCAN) {
          if (hasBareOccurrence(seg, code)) {
            const line = src.slice(0, idx).split("\n").length
            offenders.push(`${file.replace(ROOT + "/", "")}:${line} [${code}] ${seg.replace(/\s+/g, " ").trim().slice(0, 50)}`)
          }
        }
      }
    }
    expect(offenders, `acronymes nus en JSX:\n${offenders.join("\n")}`).toEqual([])
  })
})

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) =>
    (({ TIR: "Temps dans la cible" }) as Record<string, string>)[k] ?? k,
}))

describe("<Acronym>", () => {
  it("affiche l'acronyme + le libellé complet (aria-label), focusable au clavier", async () => {
    const { render, screen } = await import("@testing-library/react")
    const { Acronym } = await import("@/components/diabeo/Acronym")

    render(<Acronym code="TIR" />)

    const trigger = screen.getByText("TIR")
    expect(trigger.getAttribute("aria-label")).toBe("Temps dans la cible (TIR)")
    // <abbr> sémantique (pas un <button>) + atteignable au clavier.
    expect(trigger.tagName.toLowerCase()).toBe("abbr")
    expect(trigger.getAttribute("tabindex")).toBe("0")
  })
})
