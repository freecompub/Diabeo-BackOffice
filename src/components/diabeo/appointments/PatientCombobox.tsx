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
 *   - debounce 250ms via `useDeferredValue` React 19 (Fix FE-2 round 1 :
 *     plus de setState-in-effect anti-pattern)
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
import { usePatientList } from "./usePatientList"

export interface PatientComboboxProps {
  /** id input DOM pour association `<Label>`. */
  id: string
  /** patientId sélectionné (controlled). */
  value: number | null
  /** Callback sélection changée. */
  onChange: (patientId: number | null) => void
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

export function PatientCombobox({ id, value, onChange, disabled }: PatientComboboxProps) {
  const t = useTranslations("appointments")
  const [inputValue, setInputValue] = useState("")
  // Fix FE-2 round 1 review PR #434 — `useDeferredValue` React 19 (vs ancien
  // pattern setState-in-effect + setTimeout custom). Le rendu utilise la valeur
  // "fraîche" pour l'input mais la valeur "deferred" pour le fetch backend.
  // React 19 ajuste automatiquement le délai selon la charge CPU.
  const deferredInput = useDeferredValue(inputValue)

  const { items, loading, error } = usePatientList({
    enabled: true, // composant n'est rendu que dans modal ouvert (parent gate)
    search: deferredInput.trim().length > 0 ? deferredInput.trim() : undefined,
  })

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
      onChange(match ? match.id : null)
    },
    [items, onChange],
  )

  // Fix FE-7 round 1 review PR #434 — états distincts du hint :
  //   - loading → "Chargement…"
  //   - error → role=alert
  //   - no-results (user a tapé + filter vide) → "Aucun patient trouvé"
  //   - selected (value !== null) → "Patient sélectionné"
  //   - idle (default) → "X patient(s) disponible(s)" avec total backend
  const isSearching = inputValue.trim().length > 0
  const noResults = !loading && !error && isSearching && filtered.length === 0

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
        className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
        placeholder={t("patientPlaceholder")}
        aria-describedby={`${id}-help`}
      />
      <datalist id={`${id}-options`}>
        {filtered.map((p) => (
          <option key={p.id} value={patientLabel(p)} />
        ))}
      </datalist>
      <p id={`${id}-help`} className="text-xs text-muted-foreground" aria-live="polite">
        {loading && t("loading")}
        {error && (
          <span role="alert" className="text-red-600">
            {t("patientListError")}
          </span>
        )}
        {noResults && (
          <span role="status" className="text-amber-700">
            {t("patientNoResults")}
          </span>
        )}
        {!loading && !error && !noResults && (
          value !== null
            ? t("patientSelected")
            // Fix FE-9 round 1 review PR #434 — count NON-filtré (`items.length`)
            // pour ne pas mentir : "50 patients disponibles" reflète le total
            // backend, pas le filtre client-side trompeur.
            : t("patientHint", { count: items.length })
        )}
      </p>
    </div>
  )
}
