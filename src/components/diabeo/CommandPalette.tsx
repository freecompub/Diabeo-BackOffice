/**
 * US-2601 (Navigation) — Palette de commande & recherche rapide (Ctrl/Cmd-K).
 *
 * Ouverture globale au clavier (Ctrl/Cmd-K) ; deux familles de résultats :
 *   - « Aller à » : destinations dérivées de la source unique `navItems`
 *     (`navigation-items`), filtrées par rôle (mêmes gates que la sidebar) +
 *     par la saisie. Navigation client-side.
 *   - « Patients » : à l'ouverture, on charge une fois le portefeuille
 *     accessible (limit 50, `/api/patients/search` — RBAC, rate-limit, audit)
 *     et on **filtre en sous-chaîne côté client** (vrai type-ahead). Pour les
 *     cabinets > 50 patients, une recherche serveur **exacte** (HMAC token,
 *     ≥ 2 car.) complète la liste de base. La liste n'expose que l'identité
 *     (nom) + pathologie (libellé complet) — aucune donnée de santé détaillée.
 *
 * Sélectionner un patient ouvre son dossier (`/patients/[id]`) — l'accès est
 * journalisé par la page dossier + par la recherche. Déterministe : aucune IA.
 *
 * A11y : `Dialog` base-ui (focus-trap, `Esc`, retour focus, `initialFocus` sur
 * l'input). Saisie `combobox` (`aria-autocomplete="list"`) liée à un `listbox`
 * (`aria-activedescendant`) ; nav `↑/↓/↵`. État actif signalé hors-couleur
 * (graisse). RTL hérité du `dir` document (icônes de section non directionnelles).
 */

"use client"

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Search, User } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { resolveHomeForRole, type KnownRole } from "@/lib/auth/role-home"
import {
  navItems,
  hasRoleAccess,
  HOME_HREF_MARKER,
  type UserRole,
  type NavItem,
} from "@/components/diabeo/navigation-items"

/** Pathologies connues du glossaire (libellé complet affiché, pas l'acronyme nu). */
const PATHOLOGY_CODES = new Set(["DT1", "DT2", "GD"])

const MIN_EXACT_QUERY = 2
const PATIENT_RESULTS_CAP = 8
const BASE_LIST_LIMIT = 50

type PatientHit = { id: number; name: string; pathologyLabel: string | null }

type RawPatient = {
  id: number
  pathology: string | null
  user: { firstname: string | null; lastname: string | null }
}

type DestEntry = { kind: "dest"; id: string; href: string; label: string; icon: NavItem["icon"] }
type PatientEntry = { kind: "patient"; id: string; patientId: number; name: string; pathologyLabel: string | null }
type Entry = DestEntry | PatientEntry

export function CommandPalette({
  userRole,
  open: controlledOpen,
  onOpenChange,
}: {
  userRole: UserRole
  /**
   * US-2623 — ouverture **contrôlée** optionnelle : permet au header
   * (`NavigationShell`) d'ouvrir la palette via un bouton visible. Si non
   * fournie, la palette gère son ouverture en interne (rétro-compat). Le
   * raccourci `Ctrl/Cmd-K` fonctionne dans les deux modes.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const t = useTranslations("commandPalette")
  const tNav = useTranslations("nav")
  const tGlossary = useTranslations("glossary")
  const router = useRouter()
  const baseId = useId()

  // Ouverture contrôlée (prop) OU interne (rétro-compat). `isControlled` fige le
  // mode pour la durée de vie du composant (le parent fournit ou non la prop).
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const [basePatients, setBasePatients] = useState<PatientHit[]>([])
  const [exactHits, setExactHits] = useState<PatientHit[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const baseAbortRef = useRef<AbortController | null>(null)
  const exactAbortRef = useRef<AbortController | null>(null)

  const deferredQuery = useDeferredValue(query)

  const pathologyLabel = useCallback(
    (code: string | null): string | null =>
      code && PATHOLOGY_CODES.has(code) ? tGlossary(code as Parameters<typeof tGlossary>[0]) : null,
    [tGlossary],
  )
  const toHit = useCallback(
    (p: RawPatient): PatientHit => ({
      id: p.id,
      name: `${p.user.firstname ?? ""} ${p.user.lastname ?? ""}`.trim(),
      pathologyLabel: pathologyLabel(p.pathology),
    }),
    [pathologyLabel],
  )

  // Ref miroir de `open` pour le listener clavier (closure non périmée).
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  // Ouverture/fermeture — handler d'évènement. Le **reset** n'est PAS ici : le
  // bouton header (US-2623) ouvre via le parent (`setSearchOpen`) sans passer par
  // ce handler. Le reset vit donc dans un effet sur `open` (cf. ci-dessous) →
  // slate propre quelle que soit la source d'ouverture (bouton, Ctrl-K, parent).
  const handleOpenChange = useCallback((next: boolean) => {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
    if (!next) {
      baseAbortRef.current?.abort()
      exactAbortRef.current?.abort()
    }
  }, [isControlled, onOpenChange])

  // Reset à CHAQUE ouverture, indépendamment de la source (handleOpenChange ou
  // ouverture contrôlée par le parent). Idempotent à la fermeture (no-op).
  useEffect(() => {
    if (!open) return
    setQuery("")
    setActiveIndex(0)
    setExactHits([])
  }, [open])

  // Ctrl/Cmd-K global.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        handleOpenChange(!openRef.current)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [handleOpenChange])

  // Liste de base (portefeuille accessible, scopée serveur) chargée une fois à
  // l'ouverture — sert au filtrage sous-chaîne côté client.
  useEffect(() => {
    if (!open) {
      baseAbortRef.current?.abort()
      return
    }
    const ctrl = new AbortController()
    baseAbortRef.current = ctrl
    const run = async () => {
      try {
        const res = await fetch(`/api/patients/search?limit=${BASE_LIST_LIMIT}`, {
          credentials: "include",
          signal: ctrl.signal,
        })
        if (!res.ok) throw new Error(String(res.status))
        const data: { items?: RawPatient[] } = await res.json()
        setBasePatients((Array.isArray(data.items) ? data.items : []).map(toHit))
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return
        setBasePatients([])
      }
    }
    void run()
    return () => ctrl.abort()
  }, [open, toHit])

  // Recherche serveur EXACTE (HMAC token) en complément — couvre les cabinets
  // > 50 patients où la cible n'est pas dans la liste de base.
  useEffect(() => {
    const q = deferredQuery.trim()
    if (!open || q.length < MIN_EXACT_QUERY) {
      exactAbortRef.current?.abort()
      return
    }
    const ctrl = new AbortController()
    exactAbortRef.current = ctrl
    const run = async () => {
      setSearching(true)
      try {
        const params = new URLSearchParams({ search: q, limit: String(PATIENT_RESULTS_CAP) })
        const res = await fetch(`/api/patients/search?${params.toString()}`, {
          credentials: "include",
          signal: ctrl.signal,
        })
        if (!res.ok) throw new Error(String(res.status))
        const data: { items?: RawPatient[] } = await res.json()
        setExactHits((Array.isArray(data.items) ? data.items : []).map(toHit))
        setSearching(false)
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return
        setExactHits([])
        setSearching(false)
      }
    }
    void run()
    return () => ctrl.abort()
  }, [deferredQuery, open, toHit])

  // Destinations : source unique `navItems`, filtrées par rôle puis par saisie.
  const destinations = useMemo<DestEntry[]>(() => {
    const q = query.trim().toLowerCase()
    return navItems
      .filter((item) => hasRoleAccess(userRole, item.minRole))
      .map((item) => {
        const label =
          item.labelKey === "dashboard" && userRole === "DOCTOR"
            ? tNav("dashboardMedecin")
            : tNav(item.labelKey)
        const href = item.href === HOME_HREF_MARKER ? resolveHomeForRole(userRole as KnownRole) : item.href
        return { kind: "dest" as const, id: `${baseId}-dest-${item.labelKey}`, href, label, icon: item.icon }
      })
      .filter((e) => !q || e.label.toLowerCase().includes(q))
  }, [query, userRole, tNav, baseId])

  // Patients : filtrage sous-chaîne de la liste de base ∪ résultats exacts,
  // dédupliqués (id), cappés. Dérivé à chaque rendu → jamais de reliquat périmé.
  const patientEntries = useMemo<PatientEntry[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const fromBase = basePatients.filter((p) => p.name.toLowerCase().includes(q))
    const seen = new Set<number>()
    const merged: PatientHit[] = []
    for (const p of [...fromBase, ...exactHits]) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      merged.push(p)
      if (merged.length >= PATIENT_RESULTS_CAP) break
    }
    return merged.map((p) => ({
      kind: "patient" as const,
      id: `${baseId}-pat-${p.id}`,
      patientId: p.id,
      name: p.name || t("unnamedPatient"),
      pathologyLabel: p.pathologyLabel,
    }))
  }, [query, basePatients, exactHits, baseId, t])

  const entries = useMemo<Entry[]>(() => [...destinations, ...patientEntries], [destinations, patientEntries])

  // Index actif borné par dérivation (la liste rétrécit pendant la frappe).
  const clampedActive = entries.length === 0 ? -1 : Math.min(activeIndex, entries.length - 1)

  const activate = useCallback(
    (entry: Entry | undefined) => {
      if (!entry) return
      handleOpenChange(false)
      router.push(entry.kind === "dest" ? entry.href : `/patients/${entry.patientId}`)
    },
    [router, handleOpenChange],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (entries.length === 0) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIndex((i) => ((i < 0 ? 0 : i) + 1) % entries.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIndex((i) => ((i < 0 ? 0 : i) - 1 + entries.length) % entries.length)
      } else if (e.key === "Enter") {
        e.preventDefault()
        activate(entries[clampedActive])
      }
    },
    [entries, clampedActive, activate],
  )

  const q = query.trim()
  const showPatients = q.length > 0
  const listboxId = `${baseId}-listbox`
  const activeId = entries[clampedActive]?.id
  const rowClass = (active: boolean) =>
    `flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm ${
      active ? "bg-accent font-medium text-accent-foreground" : "hover:bg-muted"
    }`

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        initialFocus={inputRef}
        className="top-[12%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogTitle className="sr-only">{t("ariaLabel")}</DialogTitle>

        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search size={16} aria-hidden="true" className="text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
              setExactHits([])
            }}
            onKeyDown={onKeyDown}
            placeholder={t("placeholder")}
            aria-label={t("placeholder")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={entries.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <ul id={listboxId} role="listbox" aria-label={t("resultsAria")} className="max-h-80 overflow-y-auto p-2">
          {destinations.length > 0 && (
            <li role="presentation" className="px-2 py-1 text-xs font-medium text-muted-foreground">
              {t("goToGroup")}
            </li>
          )}
          {destinations.map((e) => {
            const idx = entries.indexOf(e)
            const active = idx === clampedActive
            const Icon = e.icon
            return (
              <li
                key={e.id}
                id={e.id}
                role="option"
                aria-selected={active}
                aria-label={t("navigateToAria", { section: e.label })}
                onClick={() => activate(e)}
                className={rowClass(active)}
              >
                <Icon size={14} aria-hidden="true" className="text-muted-foreground" />
                <span className="flex-1 truncate">{e.label}</span>
              </li>
            )
          })}

          {patientEntries.length > 0 && (
            <li role="presentation" className="mt-1 px-2 py-1 text-xs font-medium text-muted-foreground">
              {t("patientsGroup")}
            </li>
          )}
          {patientEntries.map((e) => {
            const idx = entries.indexOf(e)
            const active = idx === clampedActive
            const aria = e.pathologyLabel
              ? `${t("openPatientAria", { name: e.name })} · ${e.pathologyLabel}`
              : t("openPatientAria", { name: e.name })
            return (
              <li
                key={e.id}
                id={e.id}
                role="option"
                aria-selected={active}
                aria-label={aria}
                onClick={() => activate(e)}
                className={rowClass(active)}
              >
                <User size={14} aria-hidden="true" className="text-muted-foreground" />
                <span className="flex-1 truncate">{e.name}</span>
                {e.pathologyLabel && (
                  <span aria-hidden="true" className="shrink-0 text-xs text-muted-foreground">
                    {e.pathologyLabel}
                  </span>
                )}
              </li>
            )
          })}

          {searching && showPatients && (
            <li role="presentation" className="px-2 py-3 text-sm text-muted-foreground">
              {t("loading")}
            </li>
          )}
          {!searching && entries.length === 0 && (
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
