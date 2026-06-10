"use client"

/** Petit wrapper d'état (chargement / erreur) partagé par les onglets. */

import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"

export function TabLoading() {
  const t = useTranslations("consultation")
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" role="status" aria-live="polite">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {t("loading")}
    </div>
  )
}

export function TabError() {
  const t = useTranslations("consultation")
  return (
    <p className="py-8 text-center text-sm text-[var(--color-glycemia-critical)]" role="alert">
      {t("loadError")}
    </p>
  )
}
