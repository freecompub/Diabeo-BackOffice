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
 * Un sentinel sessionStorage évite la réapparition après résolution/dismiss ET
 * le re-fetch à chaque montage (le banner est dans le shell de toutes les pages).
 */

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertBanner } from "@/components/diabeo/AlertBanner"
import { locales, type Locale, buildLocaleCookieString } from "@/i18n/config"

const RECONCILED_SENTINEL = "diabeo:locale-reconciled"

const LOCALE_LABEL: Record<Locale, string> = {
  fr: "Français",
  en: "English",
  ar: "العربية",
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
    // Déjà résolu/ignoré dans cette session → ne pas re-fetch ni ré-afficher
    // (le banner est monté dans le shell de chaque page authentifiée).
    if (typeof window !== "undefined" && window.sessionStorage.getItem(RECONCILED_SENTINEL)) {
      return
    }
    const ctrl = new AbortController()
    fetch("/api/account/locale", { credentials: "include", signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: LocaleStatus | null) => {
        if (data && data.mismatch && data.active && locales.includes(data.active)) {
          setStatus(data)
        } else if (data) {
          // Pas de mismatch (ou résolu) → on pose le sentinel pour couper le
          // polling sur les navigations suivantes de la session (M1).
          window.sessionStorage.setItem(RECONCILED_SENTINEL, "1")
        }
      })
      .catch(() => {
        /* réseau / abort : pas de bannière, dégradation silencieuse (pas de
           sentinel → on retentera à la prochaine navigation) */
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
  // en base). On ne masque la bannière QUE si le PUT a réussi — sinon on laisse
  // l'utilisateur réessayer (H2 : pas de résolution trompeuse sur échec).
  const handleContinue = async () => {
    if (busy || !status.active) return
    setBusy(true)
    try {
      const res = await fetch("/api/account/locale", {
        method: "PUT",
        // X-Requested-With requis par la protection CSRF du middleware
        // (sinon 403 csrfMissing → la réconciliation de langue échoue).
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
        credentials: "include",
        body: JSON.stringify({ locale: status.active }),
      })
      if (res.ok) {
        markResolved()
      } else {
        // Échec serveur : la préférence n'a PAS changé → on garde la bannière.
        setBusy(false)
      }
    } catch {
      // Réseau coupé : idem, on garde la bannière pour un nouvel essai.
      setBusy(false)
    }
  }

  // « Revenir » : repose le cookie sur la préférence enregistrée + reload pour
  // que le serveur recharge les messages dans la préférence.
  const handleRevert = () => {
    window.sessionStorage.setItem(RECONCILED_SENTINEL, "1")
    document.cookie = buildLocaleCookieString(status.preference)
    window.location.reload()
  }

  return (
    <div className="mb-4">
      <AlertBanner
        severity="info"
        title={t("title")}
        description={t("body", { active: activeLabel, preference: preferenceLabel })}
        dismissible
        dismissLabel={t("dismiss")}
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
