"use client"

/**
 * US-2112b AC-3 — Bannière de réconciliation de langue.
 *
 * Affichée sur les écrans authentifiés (montée dans `NavigationShell`) quand la
 * langue ACTIVE (cookie `diabeo_locale`) diffère de la PRÉFÉRENCE enregistrée
 * (`User.language`). Cas typique : poste partagé où le cookie a été basculé par
 * un autre utilisateur, puis connexion d'un utilisateur dont la préférence est
 * différente.
 *
 * Non bloquante (RM-4) : dismissible, et l'utilisateur peut :
 *  - « Continuer en {langue active} » → la préférence en base est mise à jour
 *    sur la langue active (PUT /api/account/locale) ;
 *  - « Revenir à {préférence} » → repose le cookie sur la préférence + reload.
 *
 * Un sentinel sessionStorage évite la réapparition après résolution/dismiss.
 */

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertBanner } from "@/components/diabeo/AlertBanner"
import { locales, type Locale, LOCALE_COOKIE } from "@/i18n/config"

const RECONCILED_SENTINEL = "diabeo:locale-reconciled"
const LOCALE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60

const LOCALE_LABEL: Record<Locale, string> = {
  fr: "Français",
  en: "English",
  ar: "العربية",
}

function setLocaleCookieClient(locale: Locale): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_S}; SameSite=Lax${secure}`
}

interface LocaleStatus {
  preference: Locale
  active: Locale | null
  mismatch: boolean
}

export function LocaleReconciliationBanner() {
  const t = useTranslations("localeReconcile")
  const [status, setStatus] = useState<LocaleStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    // Déjà résolu/ignoré dans cette session → ne pas re-fetch ni ré-afficher.
    if (typeof window !== "undefined" && window.sessionStorage.getItem(RECONCILED_SENTINEL)) {
      return
    }
    const ctrl = new AbortController()
    fetch("/api/account/locale", { credentials: "include", signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: LocaleStatus | null) => {
        if (data && data.mismatch && data.active && locales.includes(data.active)) {
          setStatus(data)
        }
      })
      .catch(() => {
        /* réseau / abort : pas de bannière, dégradation silencieuse */
      })
    return () => ctrl.abort()
  }, [])

  if (hidden || !status || !status.active) return null

  const activeLabel = LOCALE_LABEL[status.active]
  const preferenceLabel = LOCALE_LABEL[status.preference]

  const markResolved = () => {
    window.sessionStorage.setItem(RECONCILED_SENTINEL, "1")
    setHidden(true)
  }

  // « Continuer » : adopte la langue active comme nouvelle préférence (persiste
  // en base). Pas de reload (l'affichage est déjà dans la langue active).
  const handleContinue = async () => {
    if (busy || !status.active) return
    setBusy(true)
    try {
      await fetch("/api/account/locale", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ locale: status.active }),
      })
    } finally {
      markResolved()
    }
  }

  // « Revenir » : repose le cookie sur la préférence enregistrée + reload pour
  // que le serveur recharge les messages dans la préférence.
  const handleRevert = () => {
    window.sessionStorage.setItem(RECONCILED_SENTINEL, "1")
    setLocaleCookieClient(status.preference)
    window.location.reload()
  }

  return (
    <div className="mb-4">
      <AlertBanner
        severity="info"
        title={t("title")}
        description={t("body", { active: activeLabel, preference: preferenceLabel })}
        dismissible
        onDismiss={markResolved}
      >
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleContinue}
            disabled={busy}
            className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {t("continueAction", { lang: activeLabel })}
          </button>
          <button
            type="button"
            onClick={handleRevert}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            {t("revertAction", { lang: preferenceLabel })}
          </button>
        </div>
      </AlertBanner>
    </div>
  )
}
