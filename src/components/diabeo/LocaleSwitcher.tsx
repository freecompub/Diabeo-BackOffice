/**
 * @module components/diabeo/LocaleSwitcher
 * @description US-2112 — Switcher de langue FR / EN / AR. Persiste la
 * sélection via cookie côté API (`PUT /api/account/locale`) puis force un
 * reload pour que `getLocale()` côté serveur recharge les messages
 * et applique `dir="rtl"` sur `<html>` pour AR.
 *
 * Accessibilité :
 *  - `<label>` lié au `<select>` via `htmlFor`/`id`
 *  - `aria-label` sur le wrapper pour les screen readers
 *  - Reload assumé : la transition RTL ↔ LTR ne peut pas être faite
 *    proprement sans rafraîchir l'arbre React (animations, layout caches).
 */

"use client"

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Languages } from "lucide-react"
import { locales, defaultLocale, type Locale, buildLocaleCookieString } from "@/i18n/config"

/**
 * Sentinel sessionStorage : marque qu'un reload locale-switch est en cours
 * pour restaurer le focus sur le `<select>` après reload (WCAG 2.4.3).
 *
 * On stocke un timestamp et on n'honore le sentinel que s'il est récent
 * (< 5s). Ça évite un focus parasite si :
 *  - le reload a été bloqué par une extension/popup blocker
 *  - l'utilisateur a navigué ailleurs avant la fin du reload
 *  - sessionStorage persistait d'une session précédente
 */
const FOCUS_SENTINEL = "diabeo:locale-switch-focus"
const FOCUS_SENTINEL_TTL_MS = 5_000
const SELECT_ID = "locale-select"

interface LocaleOption {
  code: Locale
  /** Label affiché — toujours dans la langue cible (UX standard pour switchers). */
  label: string
}

const OPTIONS: LocaleOption[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
]

interface Props {
  /** Variant compact pour les sidebars étroites — affiche juste le code (FR/EN/AR). */
  variant?: "full" | "compact"
  /**
   * US-2112b — `true` (défaut) : utilisateur authentifié → `PUT /api/account/locale`
   * (persiste `User.language` + cookie). `false` : écran public non authentifié
   * → pose le cookie côté client uniquement (aucun appel auth, AC-1).
   */
  persist?: boolean
}

export function LocaleSwitcher({ variant = "full", persist = true }: Props) {
  const rawLocale = useLocale()
  const t = useTranslations("common")
  const tSwitcher = useTranslations("localeSwitcher")
  // Garde runtime : si le cookie est corrompu ou la valeur server-side
  // inattendue, fallback sur le défaut (évite un crash `LOCALE_TAG[undefined]`).
  const currentLocale = ((locales as readonly string[]).includes(rawLocale)
    ? rawLocale
    : defaultLocale) as Locale
  const [pending, setPending] = useState(false)
  const [announcement, setAnnouncement] = useState<string>("")

  // Restaure le focus sur le select après un reload provoqué par le switch
  // (sinon le focus retombe sur <body> — WCAG 2.4.3 violation).
  useEffect(() => {
    if (typeof window === "undefined") return
    const raw = window.sessionStorage.getItem(FOCUS_SENTINEL)
    if (!raw) return
    // On consomme le sentinel dans tous les cas (TTL expiré OU honoré) pour
    // éviter qu'il persiste et déclenche un focus parasite plus tard.
    window.sessionStorage.removeItem(FOCUS_SENTINEL)
    const ts = Number(raw)
    if (!Number.isFinite(ts) || Date.now() - ts > FOCUS_SENTINEL_TTL_MS) return
    // Délai 0 : laisse React monter le DOM avant de focus.
    setTimeout(() => {
      document.getElementById(SELECT_ID)?.focus()
    }, 0)
  }, [])

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as Locale
    if (next === currentLocale || !(locales as readonly string[]).includes(next)) {
      return
    }

    setPending(true)
    setAnnouncement(tSwitcher("switchedAnnounce"))
    try {
      if (persist) {
        // Authentifié : persiste la préférence en base + cookie (AC-2).
        const res = await fetch("/api/account/locale", {
          method: "PUT",
          // X-Requested-With requis par la protection CSRF du middleware
          // (sinon 403 csrfMissing → la langue ne se persiste jamais, US-2112b AC-2).
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          credentials: "include",
          body: JSON.stringify({ locale: next }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      } else {
        // Écran public (AC-1) : cookie côté client uniquement, aucun appel auth.
        document.cookie = buildLocaleCookieString(next)
      }
      // Mark intent BEFORE reload so the post-reload effect can restore focus.
      // Timestamp permet au useEffect post-reload d'ignorer un sentinel stale.
      window.sessionStorage.setItem(FOCUS_SENTINEL, String(Date.now()))
      // Force reload to let server-side i18n re-evaluate (`getLocale()` reads
      // the cookie). React state alone won't switch <html dir> or messages.
      window.location.reload()
    } catch {
      setPending(false)
      setAnnouncement("")
    }
  }

  // Region polite, partagée entre les deux variants : annonce SR du reload
  // imminent quand l'utilisateur change de langue.
  const liveRegion = (
    <p aria-live="polite" aria-atomic="true" role="status" className="sr-only">
      {announcement}
    </p>
  )

  if (variant === "compact") {
    return (
      <>
        {liveRegion}
        <select
          id={SELECT_ID}
          aria-label={t("changeLanguage")}
          className="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          value={currentLocale}
          onChange={handleChange}
          disabled={pending}
        >
          {OPTIONS.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {opt.code.toUpperCase()}
            </option>
          ))}
        </select>
      </>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {liveRegion}
      <Languages
        className="h-4 w-4 text-[var(--color-muted-foreground)]"
        aria-hidden="true"
      />
      <label htmlFor={SELECT_ID} className="sr-only">
        {t("changeLanguage")}
      </label>
      <select
        id={SELECT_ID}
        className="rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
        value={currentLocale}
        onChange={handleChange}
        disabled={pending}
      >
        {OPTIONS.map((opt) => (
          <option key={opt.code} value={opt.code}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
