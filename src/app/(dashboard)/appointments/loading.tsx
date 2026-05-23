/**
 * US-2500-UI — Loading state skeleton pour la page /appointments.
 *
 * Suspense fallback rendu pendant le DL/parse du bundle Schedule-X
 * (~80-120KB gzipped). Sans ce loading, l'utilisateur voit une page
 * blanche pendant 500-1500ms sur connexion 4G médiocre.
 *
 * Fix M-6 round 2 review PR #431 — Suspense boundary segment-level.
 */

export default function AppointmentsLoading() {
  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <header className="flex flex-col gap-2">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-4 w-96 animate-pulse rounded bg-muted/60" />
      </header>
      <div className="flex flex-col gap-3">
        <div className="h-4 w-48 animate-pulse rounded bg-muted/40" />
        <div
          className="rounded-lg border border-border bg-card min-h-[640px] animate-pulse"
          aria-label="Chargement du calendrier"
        />
      </div>
    </main>
  )
}
