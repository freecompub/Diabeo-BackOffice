"use client"

/**
 * US-2500-UI — Error boundary segment-level pour la page /appointments.
 *
 * Catch les erreurs de rendu (Schedule-X exception, etc.) qui ne sont
 * pas catch par le hook useAppointments. Affiche un message friendly +
 * bouton "Réessayer" qui re-mount le segment.
 *
 * Fix M-6 round 2 review PR #431 — Error boundary segment-level.
 */

import { AlertCircle, RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"

export default function AppointmentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations("appointments")
  const tCommon = useTranslations("common")
  return (
    <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
        <AlertCircle className="h-8 w-8 text-red-600" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">
          {t("errorBoundaryTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("errorBoundaryBody")}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/70 font-mono">
            {t("errorRef", { ref: error.digest })}
          </p>
        )}
      </div>
      <button
        onClick={reset}
        className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        {tCommon("retry")}
      </button>
    </main>
  )
}
