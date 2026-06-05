"use client"

/**
 * #475 §7 — Error boundary segment-level pour la page /settings.
 *
 * Catch les erreurs de rendu inattendues (Server Component wrapper ou
 * SettingsClient). Cohérent avec les conventions `appointments/` et
 * `messages/`. Le loading est géré côté client (SettingsClient `isLoading`),
 * donc pas de `loading.tsx` co-localisé (le wrapper server est quasi-synchrone).
 */

import { AlertCircle, RefreshCw } from "lucide-react"

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
        <AlertCircle className="h-8 w-8 text-red-600" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold text-foreground">
          Erreur de chargement des paramètres
        </h1>
        <p className="text-sm text-muted-foreground">
          Une erreur s&apos;est produite lors de l&apos;affichage de vos
          paramètres. Si le problème persiste, contactez le support technique.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground/70 font-mono">
            Ref : {error.digest}
          </p>
        )}
      </div>
      <button
        onClick={reset}
        className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-2"
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        Réessayer
      </button>
    </main>
  )
}
