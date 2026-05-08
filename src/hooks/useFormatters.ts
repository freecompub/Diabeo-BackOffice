/**
 * @module hooks/useFormatters
 * @description US-2115 — Hook client React qui pré-injecte la locale courante
 * dans les formatters de `src/lib/intl/formatters.ts`.
 *
 * Permet d'écrire `const { date, glucose } = useFormatters()` puis
 * `<span>{glucose(127, "gl")}</span>` sans répéter la locale partout.
 *
 * Côté serveur : importer directement `formatDate(value, locale)` etc.
 */

"use client"

import { useLocale } from "next-intl"
import { useMemo } from "react"
import {
  formatDate,
  formatTime,
  formatRelativeTime,
  formatNumber,
  formatPercent,
  formatCurrency,
  formatGlucose,
  formatInsulinUnits,
  formatCarbs,
  type DateFormatOptions,
  type NumberFormatOptions,
  type GlucoseUnit,
} from "@/lib/intl/formatters"
import { locales, type Locale } from "@/i18n/config"

// Source unique : si `locales` évolue dans `@/i18n/config`, le set se met à
// jour automatiquement (pas de hardcode parallèle à maintenir).
const KNOWN_LOCALES = new Set<string>(locales)

export function useFormatters() {
  const rawLocale = useLocale()
  const locale = (KNOWN_LOCALES.has(rawLocale) ? rawLocale : "fr") as Locale

  return useMemo(
    () => ({
      locale,
      date: (v: Date | string | number, opts?: DateFormatOptions) =>
        formatDate(v, locale, opts),
      time: (v: Date | string | number, opts?: { useArabicDigits?: boolean; timeZone?: string }) =>
        formatTime(v, locale, opts),
      relativeTime: (v: Date | string | number, opts?: { useArabicDigits?: boolean; baseDate?: Date }) =>
        formatRelativeTime(v, locale, opts),
      number: (v: number, opts?: NumberFormatOptions) =>
        formatNumber(v, locale, opts),
      percent: (v: number, opts?: NumberFormatOptions) =>
        formatPercent(v, locale, opts),
      currency: (v: number, opts?: NumberFormatOptions & { currency?: string }) =>
        formatCurrency(v, locale, opts),
      glucose: (mgdl: number, unit: GlucoseUnit, opts?: NumberFormatOptions) =>
        formatGlucose(mgdl, locale, unit, opts),
      insulinUnits: (v: number, opts?: NumberFormatOptions) =>
        formatInsulinUnits(v, locale, opts),
      carbs: (g: number, opts?: NumberFormatOptions) =>
        formatCarbs(g, locale, opts),
    }),
    [locale],
  )
}
