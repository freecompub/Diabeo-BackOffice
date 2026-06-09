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

/** Durée de vie du cookie de locale : 1 an (préférence stable). */
export const LOCALE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60

/**
 * Construit la chaîne `document.cookie` pour la locale (usage CLIENT, sans
 * appel API — écrans non authentifiés AC-1 + bannière de réconciliation AC-3).
 * Source unique des attributs cookie côté client : DOIT rester cohérente avec
 * la pose serveur (`/api/account/locale`, `/api/auth/login`). Pure (aucun accès
 * DOM) → testable et utilisable des deux côtés.
 */
export function buildLocaleCookieString(locale: Locale): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""
  return `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_S}; SameSite=Lax${secure}`
}
