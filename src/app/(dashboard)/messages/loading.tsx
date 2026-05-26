/**
 * Fix H3 round 1 review PR #440 — loading boundary co-located pour
 * `/messages`. RSC streaming + suspense fallback cohérent patient module.
 */

import { getTranslations } from "next-intl/server"

export default async function MessagesLoading() {
  const t = await getTranslations("messages")
  return (
    <main
      className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden"
      aria-busy="true"
      aria-labelledby="messages-loading-title"
    >
      <header className="border-b border-border px-4 py-3 lg:px-6">
        <h1 id="messages-loading-title" className="text-2xl font-semibold">
          {t("pageTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("loading")}</p>
      </header>
      <div className="flex flex-1 overflow-hidden" aria-hidden="true">
        <aside className="hidden md:flex flex-col w-80 shrink-0 border-e border-border bg-card p-3">
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-md border border-slate-200 bg-slate-100"
              />
            ))}
          </div>
        </aside>
        <section className="flex-1 flex items-center justify-center">
          <div className="h-32 w-1/2 animate-pulse rounded-md border border-slate-200 bg-slate-100" />
        </section>
      </div>
    </main>
  )
}
