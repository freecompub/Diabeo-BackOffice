"use client"

/**
 * Client-component wrapper qui lazy-load le bundle Schedule-X.
 *
 * Fix H-6 round 2 review PR #431 — `next/dynamic` avec `ssr: false`
 * n'est pas autorisé dans les server components Next.js 14+ → on
 * encapsule dans un client component qui peut utiliser cette option.
 *
 * Le bundle Schedule-X (~80-120KB gzipped) n'est téléchargé qu'au mount
 * du composant, pas lors du DL initial de la page. Skeleton fourni par
 * `loading.tsx` au niveau segment route.
 */

import dynamic from "next/dynamic"

const AppointmentCalendarInner = dynamic(
  () => import("./AppointmentCalendar").then((m) => m.AppointmentCalendar),
  {
    ssr: false,
    loading: () => (
      <div
        className="rounded-lg border border-border bg-card min-h-[640px] animate-pulse"
        aria-label="Chargement du calendrier"
      />
    ),
  },
)

export interface AppointmentCalendarLazyProps {
  memberId?: number
  patientId?: number
}

export function AppointmentCalendarLazy(props: AppointmentCalendarLazyProps) {
  return <AppointmentCalendarInner {...props} />
}
