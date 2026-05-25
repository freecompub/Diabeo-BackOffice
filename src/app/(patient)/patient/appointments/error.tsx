"use client"

/**
 * Fix H5 round 1 review PR #438 — error boundary co-located pour
 * `/patient/appointments`. Sans ça, un crash de `getOwnPatientId`
 * (DB down) ou de `requireGdprConsent` (Redis down + fallback DB ko)
 * faisait crasher tout le segment patient → blank page.
 *
 * Pas de PHI dans le message d'erreur (digest opaque pour ops).
 */

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"

export default function MyAppointmentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations("appointments")

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("[/patient/appointments] error boundary:", error.digest ?? "no-digest")
    }
  }, [error])

  return (
    <main
      className="flex flex-col gap-4 p-4 lg:p-6"
      aria-labelledby="my-appointments-error-title"
    >
      <h1 id="my-appointments-error-title" className="text-2xl font-semibold">
        {t("myAppointmentsTitle")}
      </h1>
      <div
        role="alert"
        aria-live="assertive"
        className="rounded-md border border-red-600 bg-red-50 p-4 text-sm text-red-900"
      >
        <p className="font-medium">{t("myAppointmentsError")}</p>
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
