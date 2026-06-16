/**
 * US-2603 — Switcher de contexte patient.
 *
 * Dialog déclenché depuis la barre de contexte : recherche patient scopée
 * (`/api/patients/search`, même endpoint que la palette), sections « épinglés »
 * et « récemment vus » (`/api/patients/recent`), et bascule épingle
 * (`POST`/`DELETE /api/patients/[id]/pin`). Sélectionner un patient ouvre son
 * dossier — la consultation est journalisée serveur par la page de destination.
 *
 * Le périmètre est garanti serveur (intersection `getAccessiblePatientIds`) ;
 * ce composant n'affiche que ce que l'API renvoie.
 */

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Star, ArrowLeftRight } from "lucide-react"

type PatientRef = { id: number; publicRef: string; name: string; pathology: string | null }
type RawSearch = { id: number; pathology: string | null; user: { firstname: string | null; lastname: string | null } }

const MIN_QUERY = 2

export function PatientSwitcher({ currentPatientId }: { currentPatientId: number }) {
  const t = useTranslations("patientContextBar")
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<PatientRef[]>([])
  const [pinned, setPinned] = useState<PatientRef[]>([])
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(new Set())
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<PatientRef[]>([])
  const [searching, setSearching] = useState(false)
  const searchAbort = useRef<AbortController | null>(null)

  // Chargement récents + épinglés à l'ouverture.
  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    void (async () => {
      try {
        const res = await fetch("/api/patients/recent", { credentials: "include", signal: ctrl.signal })
        if (!res.ok) throw new Error(String(res.status))
        const data: { recent?: PatientRef[]; pinned?: PatientRef[] } = await res.json()
        const r = Array.isArray(data.recent) ? data.recent : []
        const p = Array.isArray(data.pinned) ? data.pinned : []
        setRecent(r)
        setPinned(p)
        setPinnedIds(new Set(p.map((x) => x.id)))
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return
        setRecent([])
        setPinned([])
      }
    })()
    return () => ctrl.abort()
  }, [open])

  // Recherche serveur scopée (exacte HMAC) dès 2 caractères.
  useEffect(() => {
    const q = query.trim()
    if (!open || q.length < MIN_QUERY) {
      searchAbort.current?.abort()
      setResults([])
      setSearching(false)
      return
    }
    const ctrl = new AbortController()
    searchAbort.current = ctrl
    setSearching(true)
    void (async () => {
      try {
        const res = await fetch(`/api/patients/search?search=${encodeURIComponent(q)}&limit=20`, {
          credentials: "include", signal: ctrl.signal,
        })
        if (!res.ok) throw new Error(String(res.status))
        const data: { items?: RawSearch[] } = await res.json()
        setResults(
          (Array.isArray(data.items) ? data.items : []).map((p) => ({
            id: p.id,
            publicRef: "",
            name: `${p.user.firstname ?? ""} ${p.user.lastname ?? ""}`.trim(),
            pathology: p.pathology,
          })),
        )
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return
        setResults([])
      } finally {
        setSearching(false)
      }
    })()
    return () => ctrl.abort()
  }, [open, query])

  const goTo = useCallback((id: number) => {
    setOpen(false)
    router.push(`/patients/${id}`)
  }, [router])

  const togglePin = useCallback(async (id: number) => {
    const isPinned = pinnedIds.has(id)
    // Optimiste : on bascule l'icône, on réconcilie via le rechargement futur.
    setPinnedIds((prev) => {
      const next = new Set(prev)
      if (isPinned) next.delete(id)
      else next.add(id)
      return next
    })
    try {
      const res = await fetch(`/api/patients/${id}/pin`, {
        method: isPinned ? "DELETE" : "POST",
        credentials: "include",
      })
      if (!res.ok) throw new Error(String(res.status))
      if (isPinned) setPinned((prev) => prev.filter((p) => p.id !== id))
    } catch {
      // Rollback de l'optimisme en cas d'échec.
      setPinnedIds((prev) => {
        const next = new Set(prev)
        if (isPinned) next.add(id)
        else next.delete(id)
        return next
      })
    }
  }, [pinnedIds])

  const showSearch = query.trim().length >= MIN_QUERY

  const renderRow = (p: PatientRef) => (
    <li key={p.id} className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => goTo(p.id)}
        disabled={p.id === currentPatientId}
        className="flex min-w-0 flex-1 items-center justify-between rounded-md px-3 py-2 text-start text-sm hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <span className="truncate font-medium">{p.name || t("unnamed")}</span>
        {p.pathology && <span className="ms-2 shrink-0 text-xs text-muted-foreground">{p.pathology}</span>}
      </button>
      <button
        type="button"
        onClick={() => togglePin(p.id)}
        aria-pressed={pinnedIds.has(p.id)}
        aria-label={pinnedIds.has(p.id) ? t("unpin") : t("pin")}
        className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Star className={`h-4 w-4 ${pinnedIds.has(p.id) ? "fill-current text-secondary" : ""}`} aria-hidden="true" />
      </button>
    </li>
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
        {t("switch")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>{t("switcherTitle")}</DialogTitle>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />

          <div className="max-h-80 overflow-y-auto">
            {showSearch ? (
              <section aria-label={t("resultsLabel")}>
                {searching && <p className="px-3 py-2 text-sm text-muted-foreground">{t("loading")}</p>}
                {!searching && results.length === 0 && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">{t("noResults")}</p>
                )}
                <ul className="space-y-0.5">{results.map(renderRow)}</ul>
              </section>
            ) : (
              <>
                {pinned.length > 0 && (
                  <section aria-label={t("pinnedLabel")} className="mb-2">
                    <h3 className="px-3 py-1 text-xs font-semibold uppercase text-muted-foreground">{t("pinnedLabel")}</h3>
                    <ul className="space-y-0.5">{pinned.map(renderRow)}</ul>
                  </section>
                )}
                <section aria-label={t("recentLabel")}>
                  <h3 className="px-3 py-1 text-xs font-semibold uppercase text-muted-foreground">{t("recentLabel")}</h3>
                  {recent.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">{t("noRecent")}</p>
                  ) : (
                    <ul className="space-y-0.5">{recent.map(renderRow)}</ul>
                  )}
                </section>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
