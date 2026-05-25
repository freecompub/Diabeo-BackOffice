"use client"

/**
 * PatientFilter — filtre patient pour le calendrier RDV.
 *
 * US-2500-UI iter 8 — Permet à un médecin de focaliser le calendrier sur
 * UN patient (e.g. pour préparer une consultation, voir l'historique d'un
 * patient spécifique). Le filtre est **server-side** : `useAppointments`
 * reçoit `patientId` qui devient un filtre Prisma backend (vs filtre
 * client-side du `<StatusFilter>` qui agit sur les `items` déjà fetchés).
 *
 * **UX** :
 *   - Si pas de filtre : bouton compact "Filtrer par patient"
 *   - Si filtre actif : chip "Patient: Jean Durand #42" + bouton "X" clear
 *
 * **A11y** : bouton clear avec `aria-label` explicite + touch target 44px.
 *
 * Réutilise `<PatientCombobox>` iter 6 pour la sélection (autocomplete +
 * accent-aware + disambiguation #id).
 */

import { useCallback, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { PatientCombobox } from "./PatientCombobox"
import { usePatientList } from "./usePatientList"
import { Button } from "@/components/ui/button"

export interface PatientFilterProps {
  /** patientId actif (null = pas de filtre). */
  value: number | null
  /** Callback sélection / clear (null = clear). */
  onChange: (patientId: number | null) => void
}

export function PatientFilter({ value, onChange }: PatientFilterProps) {
  const t = useTranslations("appointments")
  const [open, setOpen] = useState(false)

  const handleSelect = useCallback(
    (patientId: number | null) => {
      onChange(patientId)
      if (patientId !== null) {
        // Fermer le combobox après sélection — UX confirmée par chip.
        setOpen(false)
      }
    },
    [onChange],
  )

  const handleClear = useCallback(() => {
    onChange(null)
    setOpen(false)
  }, [onChange])

  // Si filtre actif, on a besoin du label patient (firstname/lastname) pour
  // afficher la chip. On fetch la liste pour retrouver le label depuis l'id.
  // (Cabinet < 50 patients, fetch déjà fait par le combobox si open.)
  const { items } = usePatientList({ enabled: value !== null })
  const selectedLabel = useMemo(() => {
    if (value === null) return null
    const found = items.find((p) => p.id === value)
    if (!found) return `#${value}` // fallback si pas encore chargé
    const parts = [found.firstname, found.lastname].filter(Boolean)
    return `${parts.join(" ").trim()} #${value}`
  }, [value, items])

  // Filtre actif : afficher chip + bouton clear
  if (value !== null && !open) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t("patientFilterLabel")} :
        </span>
        <span
          className="text-xs px-3 py-1 min-h-[28px] inline-flex items-center rounded-full bg-primary/10 text-primary"
          aria-label={t("patientFilterActive", { label: selectedLabel ?? `#${value}` })}
        >
          {selectedLabel ?? `#${value}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          aria-label={t("patientFilterClear")}
          className="min-h-[44px]"
        >
          ×
        </Button>
      </div>
    )
  }

  // Filtre inactif OU mode édition : afficher combobox
  if (open) {
    return (
      <div className="flex items-center gap-2 min-w-[240px]">
        <PatientCombobox
          id="patient-filter-combobox"
          value={value}
          onChange={handleSelect}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
          aria-label={t("patientFilterClose")}
          className="min-h-[44px]"
        >
          ×
        </Button>
      </div>
    )
  }

  // Bouton compact pour ouvrir
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      className="min-h-[44px]"
    >
      {t("patientFilterButton")}
    </Button>
  )
}
