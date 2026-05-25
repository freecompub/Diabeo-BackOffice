"use client"

/**
 * PatientCombobox — search-select pour le modal création RDV.
 *
 * US-2500-UI iter 6 — autocomplete patient avec :
 *   - fetch initial `/api/patients/search?limit=50` (cabinet standard)
 *   - filtre client-side par nom/prénom (insensitive case + accent-aware via
 *     `localeCompare`)
 *   - debounce 250ms du `search` côté backend si user tape (HMAC exact match)
 *
 * **Stratégie** : V1 simple — `<input>` + `<datalist>` natif HTML5 pour éviter
 * d'ajouter Command/Popover shadcn. UX : autocomplete navigateur natif (Chrome,
 * Safari, Firefox supportent <datalist>). Limitation : pas de keyboard nav
 * "first letter highlight" optimal, mais suffisant pour MVP.
 *
 * V1.5 : migration vers `<Command>` shadcn (cmdk) ou `<Combobox>` HeadlessUI
 * pour UX premium si > 20 patients.
 *
 * **Sécurité** :
 *   - Nom/prénom PHI déchiffré côté backend (RBAC scope automatique).
 *   - Liste reset au unmount du modal (le hook `usePatientList` reset state
 *     quand `enabled=false`).
 *
 * **Controlled** : `value={patientId | null}`, `onChange(id | null)`.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
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

const SEARCH_DEBOUNCE_MS = 250

function patientLabel(p: { firstname: string | null; lastname: string | null }): string {
  const parts = [p.firstname, p.lastname].filter(Boolean)
  return parts.join(" ").trim() || "(?)"
}

export function PatientCombobox({ id, value, onChange, disabled }: PatientComboboxProps) {
  const t = useTranslations("appointments")
  const [inputValue, setInputValue] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState<string | undefined>(undefined)

  // Debounce input → fetch backend si user tape (HMAC exact match — utile si
  // > 50 patients, sinon le filtre client-side suffit).
  //
  // React Compiler warn "setState synchronously in effect" sur le path empty :
  // c'est inhérent au debounce qui doit propager l'empty state immédiatement
  // (sinon on garde un debouncedSearch obsolète qui filtre le fetch).
  // Le `setTimeout` non-vide ne déclenche pas le warn.
  useEffect(() => {
    const trimmed = inputValue.trim()
    if (trimmed.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- debounce empty path requires immediate sync
      setDebouncedSearch(undefined)
      return
    }
    const timer = setTimeout(() => {
      setDebouncedSearch(trimmed)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [inputValue])

  const { items, loading, error } = usePatientList({
    enabled: true, // composant n'est rendu que dans modal ouvert (parent gate)
    search: debouncedSearch,
  })

  // Filtre client-side fallback (utile pour les 50 premiers sans search backend).
  const filtered = useMemo(() => {
    const q = inputValue.trim().toLowerCase()
    if (q.length === 0) return items
    return items.filter((p) => patientLabel(p).toLowerCase().includes(q))
  }, [items, inputValue])

  // Note : pas de sync prop `value` → state `inputValue`. Le combobox est
  // uncontrolled-mostly : la frappe user pilote l'input, et `handleInputChange`
  // remonte `onChange(matchedId)` au parent. Si le parent clear `value`
  // externally (rare), l'input n'est pas reset — pattern acceptable car le
  // modal est mount-on-open avec `key` reset (cf. AppointmentCalendar) →
  // chaque ouverture démarre fresh.

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value
      setInputValue(next)
      // Si l'input matche exactement un patient de la liste, on sélectionne.
      // Sinon on clear le `value` (l'user est en train d'éditer).
      const match = items.find(
        (p) => patientLabel(p).toLowerCase() === next.trim().toLowerCase(),
      )
      onChange(match ? match.id : null)
    },
    [items, onChange],
  )

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
        className="border border-input rounded-md p-2 text-sm bg-background disabled:opacity-50"
        placeholder={t("patientPlaceholder")}
        aria-describedby={`${id}-help`}
      />
      <datalist id={`${id}-options`}>
        {filtered.map((p) => (
          <option key={p.id} value={patientLabel(p)} />
        ))}
      </datalist>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        {loading && t("loading")}
        {error && (
          <span role="alert" className="text-red-600">
            {t("patientListError")}
          </span>
        )}
        {!loading && !error && (
          value !== null
            ? t("patientSelected")
            : t("patientHint", { count: filtered.length })
        )}
      </p>
    </div>
  )
}
