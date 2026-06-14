/**
 * US-2601 (Navigation) — Palette de commande & recherche rapide (Ctrl/Cmd-K).
 *
 * Ouverture globale au clavier (Ctrl/Cmd-K) ; deux familles de résultats :
 *   - « Aller à » : sections autorisées par le rôle (filtrage client cosmétique,
 *     les pages restent protégées serveur par leur propre guard RBAC).
 *   - « Patients » : recherche **scopée serveur** via `/api/patients/search`
 *     (RBAC `accessibleIds`, rate-limit, audit `READ PATIENT`). La liste n'expose
 *     que l'identité (nom) + pathologie — aucune donnée de santé détaillée.
 *
 * Sélectionner un patient ouvre son dossier (`/patients/[id]`) — l'accès est
 * journalisé par la page dossier elle-même + par la recherche. Déterministe :
 * aucune inférence, aucun calcul clinique côté frontend.
 *
 * A11y : `Dialog` (base-ui) fournit le focus-trap, `Esc`, le retour de focus et
 * `role=dialog`. La saisie est un `combobox` lié à un `listbox`
 * (`aria-activedescendant`) ; navigation `↑/↓/↵`. RTL hérité du `dir` document.
 */

"use client"

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Search, ArrowRight, User } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Acronym, type AcronymCode } from "@/components/diabeo/Acronym"
import { resolveHomeForRole, type KnownRole } from "@/lib/auth/role-home"

type UserRole = "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"

const ROLE_HIERARCHY: Record<UserRole, number> = { ADMIN: 4, DOCTOR: 3, NURSE: 2, VIEWER: 1 }

/** Sentinelle : résolue vers le home rôle-spécifique au render. */
const HOME_MARKER = "__home__"

type Destination = { href: string; navKey: string; minRole?: UserRole }

/** Sidebar maigre (US-2600) — destinations seulement, filtrées par rôle. */
const DESTINATIONS: Destination[] = [
  { href: HOME_MARKER, navKey: "dashboard" },
  { href: "/patients", navKey: "patients" },
  { href: "/appointments", navKey: "appointments", minRole: "NURSE" },
  { href: "/messages", navKey: "messages", minRole: "NURSE" },
  { href: "/documents", navKey: "documents" },
  { href: "/analytics", navKey: "analytics" },
  { href: "/settings", navKey: "settings" },
]

const PATHOLOGY_CODES = new Set<AcronymCode>(["DT1", "DT2", "GD"])
const asPathologyCode = (p: string | null): AcronymCode | null =>
  p && PATHOLOGY_CODES.has(p as AcronymCode) ? (p as AcronymCode) : null

const MIN_PATIENT_QUERY = 2
const PATIENT_SEARCH_LIMIT = 8

type PatientHit = { id: number; name: string; pathology: string | null }

type Entry =
  | { kind: "dest"; id: string; href: string; label: string }
  | { kind: "patient"; id: string; patientId: number; name: string; pathology: string | null }

export function CommandPalette({ userRole }: { userRole: UserRole }) {
  const t = useTranslations("commandPalette")
  const tNav = useTranslations("nav")
  const router = useRouter()
  const baseId = useId()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [patients, setPatients] = useState<PatientHit[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const deferredQuery = useDeferredValue(query)

  // Ref miroir de `open` pour le listener clavier (évite une closure périmée
  // et tout setState synchrone dans un effet).
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  // Ouverture/reset/fermeture — handler d'évènement (pas d'effet) : setState
  // ici est légitime (réagit à une action), contrairement au corps d'un effet.
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (next) {
      setQuery("")
      setActiveIndex(0)
      setPatients([])
    } else {
      abortRef.current?.abort()
    }
  }, [])

  // Ouverture/fermeture globale Ctrl/Cmd-K.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault()
        handleOpenChange(!openRef.current)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [handleOpenChange])

  // Recherche patient scopée serveur (≥ 2 caractères), annulable. Quand la
  // saisie est trop courte ou la palette fermée, on annule sans setState
  // synchrone — le rendu des patients est gardé par `showPatients`.
  useEffect(() => {
    const q = deferredQuery.trim()
    if (!open || q.length < MIN_PATIENT_QUERY) {
      abortRef.current?.abort()
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    // Tout le setState (y compris `loading=true`) vit dans cette fonction async,
    // pas dans le corps synchrone de l'effet (règle react-hooks/set-state-in-effect).
    const run = async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ search: q, limit: String(PATIENT_SEARCH_LIMIT) })
        const res = await fetch(`/api/patients/search?${params.toString()}`, {
          credentials: "include",
          signal: ctrl.signal,
        })
        if (!res.ok) throw new Error(String(res.status))
        const data: {
          items?: Array<{ id: number; pathology: string | null; user: { firstname: string | null; lastname: string | null } }>
        } = await res.json()
        const items = Array.isArray(data.items) ? data.items : []
        setPatients(
          items.map((p) => ({
            id: p.id,
            name: `${p.user.firstname ?? ""} ${p.user.lastname ?? ""}`.trim(),
            pathology: p.pathology,
          })),
        )
        setLoading(false)
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return
        setPatients([])
        setLoading(false)
      }
    }
    void run()
    return () => ctrl.abort()
  }, [deferredQuery, open])

  // Destinations filtrées par rôle + par la saisie (match libellé).
  const destinations = useMemo<Entry[]>(() => {
    const q = query.trim().toLowerCase()
    return DESTINATIONS.filter((d) => !d.minRole || ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[d.minRole])
      .map((d) => {
        const label =
          d.navKey === "dashboard" && userRole === "DOCTOR" ? tNav("dashboardMedecin") : tNav(d.navKey)
        const href = d.href === HOME_MARKER ? resolveHomeForRole(userRole as KnownRole) : d.href
        return { kind: "dest" as const, id: `${baseId}-dest-${d.navKey}`, href, label }
      })
      .filter((e) => !q || e.label.toLowerCase().includes(q))
  }, [query, userRole, tNav, baseId])

  // Gate d'affichage des patients : saisie ≥ seuil (le state `patients`/`loading`
  // peut être périmé après un retour sous le seuil — on s'appuie sur ce drapeau
  // plutôt que sur un reset synchrone dans l'effet de recherche).
  const showPatients = open && deferredQuery.trim().length >= MIN_PATIENT_QUERY

  const patientEntries = useMemo<Entry[]>(
    () =>
      showPatients
        ? patients.map((p) => ({
            kind: "patient" as const,
            id: `${baseId}-pat-${p.id}`,
            patientId: p.id,
            name: p.name || t("patientsGroup"),
            pathology: p.pathology,
          }))
        : [],
    [showPatients, patients, baseId, t],
  )

  const entries = useMemo(() => [...destinations, ...patientEntries], [destinations, patientEntries])

  // Index actif borné par dérivation (pas d'effet) — la liste rétrécit quand la
  // saisie affine les résultats ; on clamp à la lecture plutôt qu'en state.
  const clampedActive = entries.length === 0 ? -1 : Math.min(activeIndex, entries.length - 1)

  const activate = useCallback(
    (entry: Entry | undefined) => {
      if (!entry) return
      setOpen(false)
      router.push(entry.kind === "dest" ? entry.href : `/patients/${entry.patientId}`)
    },
    [router],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (entries.length === 0) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % entries.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIndex((i) => (i - 1 + entries.length) % entries.length)
      } else if (e.key === "Enter") {
        e.preventDefault()
        activate(entries[clampedActive])
      }
    },
    [entries, clampedActive, activate],
  )

  const q = query.trim()
  const showMinCharsHint = q.length > 0 && q.length < MIN_PATIENT_QUERY
  const listboxId = `${baseId}-listbox`
  const activeId = entries[clampedActive]?.id

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[12%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
        aria-label={t("ariaLabel")}
      >
        <DialogTitle className="sr-only">{t("ariaLabel")}</DialogTitle>

        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={16} aria-hidden="true" className="text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
            role="combobox"
            aria-expanded={entries.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <ul id={listboxId} role="listbox" aria-label={t("ariaLabel")} className="max-h-80 overflow-y-auto p-2">
          {destinations.length > 0 && (
            <li role="presentation" className="px-2 py-1 text-xs font-medium text-muted-foreground">
              {t("goToGroup")}
            </li>
          )}
          {destinations.map((e) => {
            const idx = entries.indexOf(e)
            const active = idx === clampedActive
            return (
              <li
                key={e.id}
                id={e.id}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => activate(e)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm ${active ? "bg-accent text-accent-foreground" : ""}`}
              >
                <ArrowRight size={14} aria-hidden="true" className="text-muted-foreground" />
                <span className="flex-1 truncate">{e.kind === "dest" ? e.label : ""}</span>
              </li>
            )
          })}

          {patientEntries.length > 0 && (
            <li role="presentation" className="mt-1 px-2 py-1 text-xs font-medium text-muted-foreground">
              {t("patientsGroup")}
            </li>
          )}
          {patientEntries.map((e) => {
            if (e.kind !== "patient") return null
            const idx = entries.indexOf(e)
            const active = idx === clampedActive
            const code = asPathologyCode(e.pathology)
            return (
              <li
                key={e.id}
                id={e.id}
                role="option"
                aria-selected={active}
                aria-label={t("openPatientAria", { name: e.name })}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => activate(e)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm ${active ? "bg-accent text-accent-foreground" : ""}`}
              >
                <User size={14} aria-hidden="true" className="text-muted-foreground" />
                <span className="flex-1 truncate">{e.name}</span>
                {code && <Acronym code={code} />}
              </li>
            )
          })}

          {loading && showPatients && (
            <li role="presentation" className="px-2 py-3 text-sm text-muted-foreground">
              {t("loading")}
            </li>
          )}
          {showMinCharsHint && (
            <li role="presentation" className="px-2 py-3 text-sm text-muted-foreground">
              {t("minCharsHint")}
            </li>
          )}
          {!(loading && showPatients) && !showMinCharsHint && entries.length === 0 && (
            <li role="presentation" className="px-2 py-3 text-sm text-muted-foreground">
              {t("noResults")}
            </li>
          )}
        </ul>

        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{t("hint")}</p>
      </DialogContent>
    </Dialog>
  )
}
