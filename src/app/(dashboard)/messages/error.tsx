"use client"

/**
 * Fix H3 round 1 review PR #440 — error boundary co-located pour
 * `/messages`. Cohérence avec US-2500-UI iter 12 (patient module).
 *
 * Sans ça, un crash de `requireGdprConsent` (Redis down + fallback DB ko)
 * ou de `MessagingInbox` faisait crasher tout le segment dashboard →
 * white screen pour le médecin/infirmier.
 *
 * Pas de PHI dans le message d'erreur (digest opaque pour ops).
 */

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"

export default function MessagesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations("messages")

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("[/messages] error boundary:", error.digest ?? "no-digest")
    }
  }, [error])

  return (
    <main
      className="flex flex-col gap-4 p-4 lg:p-6"
      aria-labelledby="messages-error-title"
    >
      <h1 id="messages-error-title" className="text-2xl font-semibold">
        {t("pageTitle")}
      </h1>
      <div
        role="alert"
        aria-live="assertive"
        className="rounded-md border border-red-700 bg-red-50 p-4 text-sm text-red-900"
      >
        <p className="font-medium">{t("loadError")}</p>
        {error.digest ? (
          <p className="mt-2 font-mono text-xs text-red-800">{`ref: ${error.digest}`}</p>
        ) : null}
      </div>
      <div>
        <Button
          variant="default"
          onClick={() => reset()}
          className="min-h-[44px]"
        >
          {t("actionRetry")}
        </Button>
      </div>
    </main>
  )
}
