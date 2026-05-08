/**
 * @module lib/intl/formatters
 * @description US-2115 — Helpers de formatage date / nombre / glycémie /
 * temps relatif, locale-aware FR / EN / AR.
 *
 * **Pourquoi un module dédié** : `Intl.DateTimeFormat` / `NumberFormat` /
 * `RelativeTimeFormat` sont natifs et performants, mais leurs options
 * varient selon le contexte clinique (mg/dL vs g/L, mmol/L, format jj/mm
 * vs mm/dd, etc.). Centraliser ici prévient :
 *  - le drift entre composants (3 façons différentes d'afficher une date)
 *  - les calculs RTL erronés (chiffres arabes vs occidentaux)
 *  - les leaks RGPD via `toLocaleString` qui peut inclure le timezone client
 *
 * **Locale détection** : importer ce module ne fait PAS de `useLocale()` —
 * c'est volontaire (server-side compatibilité). Chaque fonction prend la
 * locale en paramètre. Pour le côté client React, voir le hook
 * `useFormatters()` dans `src/hooks/useFormatters.ts`.
 *
 * **Numbering systems** : par défaut Intl utilise `latn` (chiffres 0-9
 * occidentaux) même en `ar`. C'est généralement préféré dans un contexte
 * médical pour éviter l'ambiguïté de lecture transfrontalière. L'option
 * `useArabicDigits` permet d'opter pour `arab` (chiffres arabo-indiens
 * ٠-٩) si l'UX l'exige ponctuellement.
 */

import type { Locale } from "@/i18n/config"

// ─────────────────────────────────────────────────────────────────────────────
// Locale → BCP 47 mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BCP 47 tags pour Intl. `ar-MA` est choisi (Maroc) car :
 *  - calendrier grégorien par défaut (vs `ar-SA` qui pousse l'islamique)
 *  - DZD/MAD comme devise contextuelle plus probable que SAR
 *  - tous les helpers Intl sont supportés
 *
 * Si l'app cible explicitement KSA/UAE plus tard, ajouter une option
 * `country` au paramètre.
 */
const LOCALE_TAG: Record<Locale, string> = {
  fr: "fr-FR",
  en: "en-GB",
  ar: "ar-MA",
}

/** Devise par défaut par locale. Le caller peut override. */
const DEFAULT_CURRENCY: Record<Locale, string> = {
  fr: "EUR",
  en: "EUR",
  ar: "EUR",
}

function tag(locale: Locale, options?: { useArabicDigits?: boolean }): string {
  const base = LOCALE_TAG[locale]
  if (locale === "ar" && options?.useArabicDigits === false) {
    // Force `latn` numbering even in `ar` context.
    return `${base}-u-nu-latn`
  }
  if (locale === "ar" && options?.useArabicDigits === true) {
    return `${base}-u-nu-arab`
  }
  return base
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────

export interface DateFormatOptions {
  /** Style raccourci. Par défaut `medium`. */
  style?: "short" | "medium" | "long" | "full"
  /** Inclure l'heure. Par défaut `false`. */
  withTime?: boolean
  /** Forcer chiffres arabo-indiens en locale `ar` (par défaut latins). */
  useArabicDigits?: boolean
  /** TimeZone IANA (ex: "Europe/Paris"). Par défaut UTC pour cohérence
   *  serveur (évite les fuites du tz client). */
  timeZone?: string
}

const STYLE_MAP: Record<NonNullable<DateFormatOptions["style"]>, Intl.DateTimeFormatOptions> = {
  short: { dateStyle: "short" },
  medium: { dateStyle: "medium" },
  long: { dateStyle: "long" },
  full: { dateStyle: "full" },
}

/**
 * Format une date selon la locale.
 * - `fr` : "15 mars 2026"
 * - `en` : "15 Mar 2026"
 * - `ar` : "١٥ مارس ٢٠٢٦" (ou "15 مارس 2026" si useArabicDigits=false)
 */
export function formatDate(
  value: Date | string | number,
  locale: Locale,
  options: DateFormatOptions = {},
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (isNaN(date.getTime())) return ""

  const intlOpts: Intl.DateTimeFormatOptions = {
    ...STYLE_MAP[options.style ?? "medium"],
    ...(options.withTime && { timeStyle: "short" as const }),
    timeZone: options.timeZone ?? "UTC",
  }
  return new Intl.DateTimeFormat(tag(locale, options), intlOpts).format(date)
}

/**
 * Format une heure seule (sans date).
 */
export function formatTime(
  value: Date | string | number,
  locale: Locale,
  options: Pick<DateFormatOptions, "useArabicDigits" | "timeZone"> = {},
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(tag(locale, options), {
    timeStyle: "short",
    timeZone: options.timeZone ?? "UTC",
  }).format(date)
}

/**
 * Format relatif "il y a 3 minutes" / "in 2 days" / "منذ ٥ دقائق".
 * Choisit l'unité la plus appropriée automatiquement (s, min, h, j, mois, an).
 */
export function formatRelativeTime(
  value: Date | string | number,
  locale: Locale,
  options: { useArabicDigits?: boolean; baseDate?: Date } = {},
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (isNaN(date.getTime())) return ""

  const base = options.baseDate ?? new Date()
  const diffMs = date.getTime() - base.getTime()
  const diffSec = Math.round(diffMs / 1_000)
  const absSec = Math.abs(diffSec)

  const rtf = new Intl.RelativeTimeFormat(tag(locale, options), { numeric: "auto" })

  if (absSec < 60) return rtf.format(diffSec, "second")
  if (absSec < 3_600) return rtf.format(Math.round(diffSec / 60), "minute")
  if (absSec < 86_400) return rtf.format(Math.round(diffSec / 3_600), "hour")
  if (absSec < 2_592_000) return rtf.format(Math.round(diffSec / 86_400), "day")
  if (absSec < 31_536_000) return rtf.format(Math.round(diffSec / 2_592_000), "month")
  return rtf.format(Math.round(diffSec / 31_536_000), "year")
}

// ─────────────────────────────────────────────────────────────────────────────
// Nombres / pourcentages / devises
// ─────────────────────────────────────────────────────────────────────────────

export interface NumberFormatOptions {
  /** Nombre de décimales. */
  decimals?: number
  /** Forcer chiffres arabo-indiens en locale `ar`. */
  useArabicDigits?: boolean
}

/**
 * Format un nombre standard. Respecte les séparateurs locaux :
 * - `fr` : "1 234,56" (espace insécable + virgule)
 * - `en` : "1,234.56"
 * - `ar` : "١٬٢٣٤٫٥٦" (selon numbering system)
 */
export function formatNumber(
  value: number,
  locale: Locale,
  options: NumberFormatOptions = {},
): string {
  if (!Number.isFinite(value)) return ""
  const decimals = options.decimals ?? 0
  return new Intl.NumberFormat(tag(locale, options), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

/**
 * Format un pourcentage. La valeur est attendue en fraction (0.75 → 75%).
 */
export function formatPercent(
  value: number,
  locale: Locale,
  options: NumberFormatOptions = {},
): string {
  if (!Number.isFinite(value)) return ""
  return new Intl.NumberFormat(tag(locale, options), {
    style: "percent",
    minimumFractionDigits: options.decimals ?? 0,
    maximumFractionDigits: options.decimals ?? 0,
  }).format(value)
}

/**
 * Format une devise (par défaut EUR par locale).
 */
export function formatCurrency(
  value: number,
  locale: Locale,
  options: NumberFormatOptions & { currency?: string } = {},
): string {
  if (!Number.isFinite(value)) return ""
  return new Intl.NumberFormat(tag(locale, options), {
    style: "currency",
    currency: options.currency ?? DEFAULT_CURRENCY[locale],
    minimumFractionDigits: options.decimals ?? 2,
    maximumFractionDigits: options.decimals ?? 2,
  }).format(value)
}

// ─────────────────────────────────────────────────────────────────────────────
// Glycémie — domaine métier (mg/dL ↔ g/L ↔ mmol/L)
// ─────────────────────────────────────────────────────────────────────────────

export type GlucoseUnit = "mgdl" | "gl" | "mmoll"

/**
 * Format une glycémie selon l'unité choisie + la locale.
 * Conversions :
 *  - 1 mmol/L glucose = 18.0182 mg/dL
 *  - 1 g/L = 100 mg/dL
 *
 * @param valueMgdl  La valeur source en mg/dL (canonical interne du repo).
 * @param locale     Locale d'affichage.
 * @param targetUnit Unité de sortie. `mgdl` (def US/AR), `gl` (def FR), `mmoll`.
 * @example
 *   formatGlucose(127, "fr", "gl")  // → "1,27 g/L"
 *   formatGlucose(127, "en", "mgdl") // → "127 mg/dL"
 *   formatGlucose(7.05, "en", "mmoll") // → "7.1 mmol/L"
 */
export function formatGlucose(
  valueMgdl: number,
  locale: Locale,
  targetUnit: GlucoseUnit,
  options: NumberFormatOptions = {},
): string {
  if (!Number.isFinite(valueMgdl)) return ""

  let value: number
  let unitLabel: string
  let decimals: number
  switch (targetUnit) {
    case "gl":
      value = valueMgdl / 100
      unitLabel = "g/L"
      decimals = options.decimals ?? 2
      break
    case "mmoll":
      value = valueMgdl / 18.0182
      unitLabel = "mmol/L"
      decimals = options.decimals ?? 1
      break
    case "mgdl":
    default:
      value = valueMgdl
      unitLabel = "mg/dL"
      decimals = options.decimals ?? 0
      break
  }

  const formatted = formatNumber(value, locale, {
    decimals,
    useArabicDigits: options.useArabicDigits,
  })
  return `${formatted} ${unitLabel}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Quantités cliniques génériques
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format une quantité d'insuline (unités). Toujours 1 ou 2 décimales.
 * - `fr` : "5,5 U"
 * - `en` : "5.5 U"
 */
export function formatInsulinUnits(
  value: number,
  locale: Locale,
  options: NumberFormatOptions = {},
): string {
  return `${formatNumber(value, locale, { decimals: options.decimals ?? 1, useArabicDigits: options.useArabicDigits })} U`
}

/**
 * Format des grammes de glucides.
 */
export function formatCarbs(
  grams: number,
  locale: Locale,
  options: NumberFormatOptions = {},
): string {
  return `${formatNumber(grams, locale, { decimals: options.decimals ?? 0, useArabicDigits: options.useArabicDigits })} g`
}
