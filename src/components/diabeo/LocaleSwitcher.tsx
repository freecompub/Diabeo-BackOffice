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

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Languages } from "lucide-react"
import { locales, type Locale } from "@/i18n/config"

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
}

export function LocaleSwitcher({ variant = "full" }: Props) {
  const currentLocale = useLocale() as Locale
  const t = useTranslations("common")
  const [pending, setPending] = useState(false)

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as Locale
    if (next === currentLocale || !locales.includes(next)) return

    setPending(true)
    try {
      const res = await fetch("/api/account/locale", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Force reload to let server-side i18n re-evaluate (`getLocale()` reads
      // the cookie). React state alone won't switch <html dir> or messages.
      window.location.reload()
    } catch {
      setPending(false)
    }
  }

  if (variant === "compact") {
    return (
      <select
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
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Languages
        className="h-4 w-4 text-[var(--color-muted-foreground)]"
        aria-hidden="true"
      />
      <label htmlFor="locale-select" className="sr-only">
        {t("changeLanguage")}
      </label>
      <select
        id="locale-select"
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
