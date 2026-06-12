"use client"

/**
 * PatientCombobox — search-select pour le modal création RDV.
 *
 * US-2500-UI iter 6 — autocomplete patient avec :
 *   - fetch initial `/api/patients/search?limit=50` (cabinet standard)
 *   - filtre client-side **accent-aware** + insensitive case via
 *     `String.prototype.normalize("NFD")` (Fix CR-H3/FE-1 round 1 PR #434 :
 *     "Müller" matche "muller", "Pérez" matche "perez", "Šimić" matche "simic")
 *   - **disambiguation #id** dans le label affiché (Fix CR-H3/FE-6 round 1 :
 *     2 patients homonymes "Jean Martin" deviennent "Jean Martin #42" vs
 *     "Jean Martin #43" → médecin distingue visuellement, élimine le risque
 *     clinique de RDV créé pour le mauvais patient)
 *   - **filtrage 100% client-side** sur la liste large (≤ 50) fetchée une seule
 *     fois : le backend `search=` fait un match HMAC EXACT (prénom/nom complet)
 *     incompatible avec une recherche au fil de la frappe, donc on ne l'appelle
 *     pas par keystroke (sinon `items` se vide → faux "aucun patient").
 *
 * **Stratégie** : V1 simple — `<input>` + `<datalist>` natif HTML5 pour éviter
 * d'ajouter Command/Popover shadcn. UX : autocomplete navigateur natif (Chrome,
 * Safari, Firefox supportent <datalist>). Limitations connues :
 *   - Safari iOS rendering inconsistant (impact limité — backoffice desktop)
 *   - Pas de keyboard nav "first letter highlight" optimal
 *   - Pas de stylage CSS du dropdown
 *
 * V1.5 (issue à créer) : migration vers `<Command>` shadcn (cmdk) ou
 * `<Combobox>` HeadlessUI pour UX premium si > 20 patients + a11y
 * `aria-listbox` standardisée (vs `<datalist>` a11y limitée).
 *
 * **Sécurité** :
 *   - Nom/prénom PHI déchiffré côté backend (RBAC scope automatique).
 *   - Liste reset au unmount du modal (key remount au close — pattern iter 5).
 *
 * **Controlled** : `value={patientId | null}`, `onChange(id | null)`.
 */

import { useCallback, useDeferredValue, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { usePatientList, type PatientListItem } from "./usePatientList"

export interface PatientComboboxProps {
  /** id input DOM pour association `<Label>`. */
  id: string
  /** patientId sélectionné (controlled). */
  value: number | null
  /**
   * Callback sélection changée.
   *
   * Fix FE-2 round 1 review PR #436 — propage aussi le `label` du patient
   * (firstname lastname #id) pour permettre au caller de l'afficher sans
   * re-fetcher la liste via `usePatientList` (élimine le double-fetch
   * `<PatientFilter>` ↔ `<PatientCombobox>` round 1).
   * `label` est `null` quand `patientId === null` (clear) OU quand le user
   * tape sans match exact.
   */
  onChange: (patientId: number | null, label: string | null) => void
  /** Désactive le combobox (e.g. pendant submit). */
  disabled?: boolean
}

/**
 * Fix CR-H3/FE-1/FE-6 round 1 review PR #434 — Label avec disambiguation
 * `#id` pour distinguer homonymes ("Jean Martin #42" vs "Jean Martin #43").
 */
function patientLabel(p: { id: number; firstname: string | null; lastname: string | null }): string {
  const parts = [p.firstname, p.lastname].filter(Boolean)
  const name = parts.join(" ").trim() || "(?)"
  return `${name} #${p.id}`
}

/**
 * Fix CR-H3/FE-1 round 1 review PR #434 — Normalisation accent-aware pour
 * comparaisons :
 *   - NFD : décompose les caractères accentués (é → e + combining acute)
 *   - replace Diacritic : supprime les marques diacritiques (combining acute)
 *   - toLowerCase : insensitive case
 *
 * Résultat : "Müller", "Pérez", "Šimić" matchent respectivement "muller",
 * "perez", "simic" sans accent.
 */
function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
}

/**
 * Longueur minimale avant de solliciter la recherche backend complémentaire.
 * Évite de marteler un endpoint PHI sur chaque 1re lettre (revue PR #531).
 */
const MIN_BACKEND_SEARCH_LEN = 2

export function PatientCombobox({ id, value, onChange, disabled }: PatientComboboxProps) {
  const t = useTranslations("appointments")
  const [inputValue, setInputValue] = useState("")

  // ── Liste base (stable) ────────────────────────────────────────────────
  // Fetch large (≤ 50) UNE seule fois, jamais piloté par la frappe. Sert de
  // socle au filtrage client-side accent-aware. Le backend `search=` étant un
  // match HMAC **exact**, l'alimenter au fil de la frappe viderait la liste
  // (fragment "Jea" → 0 match) → faux "Aucun patient ne correspond" + input
  // disabled. Le composant n'est rendu que dans un modal ouvert (parent gate).
  const base = usePatientList({ enabled: true })

  // ── Recherche backend complémentaire (cabinets > 50 patients) ──────────
  // Un patient absent des 50 premiers devient trouvable en tapant son nom OU
  // prénom COMPLET (le backend tokenise + matche par HMAC exact, cf.
  // patient.service → search). Ses résultats AUGMENTENT la liste (merge
  // ci-dessous) au lieu de la remplacer → pas de collapse, sélection préservée.
  //
  // ⚠️ `useDeferredValue` n'est PAS un debounce réseau : il diffère seulement la
  // priorité de RENDU, donc le fetch part dès que la valeur déférée se stabilise.
  // On gate sur `MIN_BACKEND_SEARCH_LEN` pour ne pas frapper l'endpoint PHI sur
  // chaque 1re lettre ; `usePatientList` annule la requête précédente
  // (AbortController) à chaque changement de `search`.
  const deferredSearch = useDeferredValue(inputValue.trim())
  const searchActive = deferredSearch.length >= MIN_BACKEND_SEARCH_LEN
  const search = usePatientList({
    enabled: searchActive,
    search: searchActive ? deferredSearch : undefined,
  })

  // Union dédupliquée par id (base d'abord → ordre stable, hits de recherche
  // ajoutés ensuite). `items` est la liste affichée + filtrée client-side.
  const items = useMemo<PatientListItem[]>(() => {
    const byId = new Map<number, PatientListItem>()
    for (const p of base.items) byId.set(p.id, p)
    for (const p of search.items) if (!byId.has(p.id)) byId.set(p.id, p)
    return [...byId.values()]
  }, [base.items, search.items])

  const loading = base.loading
  // Seul l'échec de la liste BASE bloque. Un échec de la recherche
  // complémentaire (token bizarre → 500) ne doit PAS transformer un combobox
  // fonctionnel en bandeau d'erreur : il se traduit juste par une absence
  // d'augmentation (revue PR #531).
  const error = base.error
  const searching = searchActive && search.loading

  // Filtre client-side fallback (utile pour les 50 premiers sans search backend).
  // Accent-aware via `normalize()` — couvre "Müller" tapé "muller".
  const filtered = useMemo(() => {
    const q = normalize(inputValue.trim())
    if (q.length === 0) return items
    return items.filter((p) => normalize(patientLabel(p)).includes(q))
  }, [items, inputValue])

  // Note : pas de sync prop `value` → state `inputValue`. Le combobox est
  // uncontrolled-mostly : la frappe user pilote l'input, et `handleInputChange`
  // remonte `onChange(matchedId)` au parent. Modal mount-on-open avec `key`
  // reset → chaque ouverture démarre fresh.

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value
      setInputValue(next)
      // Match accent-aware via normalize() (Fix CR-H3 — sinon "Müller" ne
      // match jamais après frappe "müller #42").
      const normalizedInput = normalize(next.trim())
      const match = items.find(
        (p) => normalize(patientLabel(p)) === normalizedInput,
      )
      // Fix FE-2 round 1 review PR #436 — propage le label avec l'id pour
      // que le caller puisse l'afficher sans re-fetcher la liste patients.
      onChange(match ? match.id : null, match ? patientLabel(match) : null)
    },
    [items, onChange],
  )

  // Fix FE-7 round 1 review PR #434 — états distincts du hint :
  //   - loading → "Chargement…"
  //   - error → région role=alert dédiée (séparée du live region polite)
  //   - searching → recherche complémentaire en vol : signalée via `aria-busy`
  //     sur l'input (PAS annoncée en texte, anti-spam SR) + anti-flicker (on
  //     n'affiche pas "aucun résultat" tant qu'un fetch peut remonter un >50)
  //   - no-results (user a tapé + filter vide) → "Aucun patient trouvé"
  //   - selected (value !== null) → "Patient sélectionné"
  //   - idle (default) → "X patient(s) disponible(s)" avec total backend
  const isSearching = inputValue.trim().length > 0
  const noResults =
    !loading && !error && !searching && isSearching && filtered.length === 0

  return (
    <div className="grid gap-1">
      <input
        id={id}
        type="text"
        list={`${id}-options`}
        value={inputValue}
        onChange={handleInputChange}
        disabled={disabled || loading}
        autoComplete="off"
        spellCheck={false}
        aria-required="true"
        aria-invalid={value === null && isSearching ? "true" : undefined}
        // Recherche complémentaire en vol → `aria-busy` (état "occupé") plutôt
        // qu'un texte annoncé à chaque frappe dans le live region (revue a11y).
        aria-busy={searching ? "true" : undefined}
        // `aria-controls` vers la datalist : compense l'absence d'aria-expanded
        // (impossible sur `<input list>` natif — l'ouverture est gérée par le
        // navigateur, non détectable en JS). Revue a11y round 2.
        aria-controls={`${id}-options`}
        className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
        placeholder={t("patientPlaceholder")}
        // `aria-describedby` STABLE (help seul) : l'erreur est déjà annoncée par
        // sa région `role="alert"` (assertive). Éviter de basculer 1↔2 ids
        // (référence ARIA orpheline au démontage de l'erreur — revue a11y r2).
        aria-describedby={`${id}-help`}
      />
      <datalist id={`${id}-options`}>
        {filtered.map((p) => (
          <option key={p.id} value={patientLabel(p)} />
        ))}
      </datalist>

      {/* Erreur — région ASSERTIVE dédiée (role=alert), hors du live region
          "polite" (évite l'alert imbriqué dans un polite — revue a11y r1).
          Annoncée d'elle-même à l'apparition ; pas référencée par
          aria-describedby (évite la référence orpheline au démontage — r2). */}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {t("patientListError")}
        </p>
      )}

      {/* Statut/hint — région POLITE. PAS `aria-atomic` (sinon chaque mutation
          relit toute la région → sur-annonce sur les transitions — revue a11y
          r2). Le "searching" transitoire reste visible mais `aria-hidden`
          (l'info SR est portée par `aria-busy` sur l'input). */}
      <p
        id={`${id}-help`}
        className="text-xs text-muted-foreground"
        aria-live="polite"
      >
        {loading && t("loading")}
        {searching && !loading && !error && (
          <span aria-hidden="true">{t("patientSearching")}</span>
        )}
        {noResults && (
          <span className="text-amber-700">{t("patientNoResults")}</span>
        )}
        {!loading && !error && !searching && !noResults && (
          value !== null
            ? t("patientSelected")
            // Fix FE-9 round 1 review PR #434 — count NON-filtré (`items.length`)
            // pour ne pas mentir : reflète le total chargé (base ∪ recherche),
            // pas le filtre client-side trompeur.
            : t("patientHint", { count: items.length })
        )}
      </p>
    </div>
  )
}
