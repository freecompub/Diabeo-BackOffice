/**
 * Fix H5 round 1 review PR #438 — loading boundary co-located pour
 * `/patient/appointments`. RSC streaming + suspense fallback.
 */

import { getTranslations } from "next-intl/server"

export default async function MyAppointmentsLoading() {
  const t = await getTranslations("appointments")
  return (
    <main
      className="flex flex-col gap-6 p-4 lg:p-6"
      aria-busy="true"
      aria-labelledby="my-appointments-loading-title"
    >
      <header>
        <h1 id="my-appointments-loading-title" className="text-2xl font-semibold">
          {t("myAppointmentsTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("myAppointmentsLoading")}
        </p>
      </header>
      <div className="space-y-3" aria-hidden="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-md border border-slate-200 bg-slate-100"
          />
        ))}
      </div>
    </main>
  )
}
