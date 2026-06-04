/**
 * Test suite: i18n key parity across locales (fr / en / ar)
 *
 * Why this matters:
 * - A key present in one locale but missing in another causes a silent
 *   fallback (or a `MISSING_MESSAGE` error) for users of the incomplete
 *   locale — exactly the class of bug fixed in PR #467 (the `/patients/new`
 *   wizard referenced 20 `patients.*` keys absent from all locales).
 * - The Arabic locale (RTL) is the one most likely to drift, so a structural
 *   guard prevents shipping a half-translated screen.
 *
 * This is a CI guard (F15): it fails the build if the three message catalogs
 * stop having the exact same set of (nested) keys.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

type Json = Record<string, unknown>

function load(locale: string): Json {
  const url = new URL(`../../messages/${locale}.json`, import.meta.url)
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as Json
}

/** Flatten to dotted key paths (objects recursed; arrays/scalars are leaves). */
function flattenKeys(obj: Json, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k
    return v && typeof v === "object" && !Array.isArray(v)
      ? flattenKeys(v as Json, path)
      : [path]
  })
}

const LOCALES = ["fr", "en", "ar"] as const
const keysByLocale = Object.fromEntries(
  LOCALES.map((l) => [l, new Set(flattenKeys(load(l)))]),
) as Record<(typeof LOCALES)[number], Set<string>>

describe("i18n key parity (fr / en / ar)", () => {
  it("every locale exposes the exact same set of keys (reference = fr)", () => {
    const ref = keysByLocale.fr
    for (const locale of ["en", "ar"] as const) {
      const target = keysByLocale[locale]
      const missing = [...ref].filter((k) => !target.has(k)).sort()
      const extra = [...target].filter((k) => !ref.has(k)).sort()
      expect(
        { locale, missing, extra },
        `Locale "${locale}" diverges from fr — missing: ${JSON.stringify(missing)}; extra: ${JSON.stringify(extra)}`,
      ).toEqual({ locale, missing: [], extra: [] })
    }
  })

  it("the /patients/new wizard keys exist in all locales (PR #467 regression guard)", () => {
    const wizardKeys = [
      "patients.newPatient", "patients.step", "patients.of", "patients.identity",
      "patients.pathology", "patients.pathologyDescription", "patients.yearOfDiagnosis",
      "patients.back", "patients.creating", "patients.createPatient",
      "patients.emailLabel", "patients.invalidEmailFormat", "patients.errorTitle",
      "patients.errorEmailExists", "patients.errorServerError", "patients.yearRangeHint",
      "patients.dt1Description", "patients.dt2Description", "patients.gdDescription",
    ]
    for (const locale of LOCALES) {
      const present = wizardKeys.filter((k) => keysByLocale[locale].has(k))
      expect(present, `Locale "${locale}" is missing wizard keys`).toEqual(wizardKeys)
    }
  })
})
