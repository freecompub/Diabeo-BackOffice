/**
 * i18n Configuration — Diabeo Backoffice
 *
 * Supported locales: French (default), English, Arabic (RTL).
 * Locale is stored as user preference via cookie "diabeo_locale".
 */

export const locales = ["fr", "en", "ar"] as const
export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = "fr"

/** RTL locales — used to set dir="rtl" on <html> */
export const rtlLocales: readonly Locale[] = ["ar"] as const

export function isRtlLocale(locale: Locale): boolean {
  return (rtlLocales as readonly string[]).includes(locale)
}

export const LOCALE_COOKIE = "diabeo_locale"
