"use client"

/**
 * PatientFilter — filtre patient pour le calendrier RDV.
 *
 * US-2500-UI iter 8 — Permet à un médecin de focaliser le calendrier sur
 * UN patient. Le filtre est **server-side** : `useAppointments` reçoit
 * `patientId` qui devient un filtre Prisma backend.
 *
 * **UX** :
 *   - Si pas de filtre : bouton compact "Filtrer par patient"
 *   - Si filtre actif : chip "Patient: Jean Durand #42" + bouton "X" clear
 *   - Si édition : combobox autocomplete
 *
 * **A11y** : bouton clear avec `aria-label` explicite, `aria-hidden` sur le
 * caractère `×` purement décoratif (Fix FE-12 round 1 review PR #436),
 * touch target 44px.
 *
 * **Fix FE-2 round 1 review PR #436** : le label est propagé par
 * `<PatientCombobox>` via `onChange(id, label)` (vs ancien `<PatientCombobox>`
 * qui ne donnait que l'id, forçant un re-fetch `usePatientList` côté parent
 * juste pour afficher le label). Single fetch via le combobox uniquement.
 */

import { useCallback, useState } from "react"
import { useTranslations } from "next-intl"
import { PatientCombobox } from "./PatientCombobox"
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
  // Fix FE-2 round 1 — label local persisté depuis `<PatientCombobox>` au
  // moment de la sélection, vs ancien `usePatientList` fetch côté parent.
  // Synchronisé avec `value` : si parent clear externally (value=null),
  // on clear aussi le label.
  const [label, setLabel] = useState<string | null>(null)

  const handleSelect = useCallback(
    (patientId: number | null, nextLabel: string | null) => {
      onChange(patientId)
      setLabel(nextLabel)
      if (patientId !== null) {
        // Fermer le combobox après sélection — UX confirmée par chip.
        setOpen(false)
      }
      // Fix CR-14 round 1 review PR #436 — fermer aussi si clear via clavier.
      if (patientId === null && nextLabel === null && open) {
        setOpen(false)
      }
    },
    [onChange, open],
  )

  const handleClear = useCallback(() => {
    onChange(null)
    setLabel(null)
    setOpen(false)
  }, [onChange])

  // Filtre actif : afficher chip + bouton clear
  if (value !== null && !open) {
    const displayLabel = label ?? `#${value}`
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t("patientFilterLabel")} :
        </span>
        {/* Fix CR-6 round 1 review PR #436 — pas d'aria-label dupliqué.
            Le texte visible est lu par le SR comme accessible name natif. */}
        <span className="text-xs px-3 py-1 min-h-[28px] inline-flex items-center rounded-full bg-primary/10 text-primary">
          {displayLabel}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          aria-label={t("patientFilterClear")}
          className="min-h-[44px]"
        >
          {/* Fix FE-12 round 1 review PR #436 — aria-hidden sur le glyphe
              décoratif × (sinon SR vocalise "multiplication"). aria-label
              du bouton englobant est l'accessible name. */}
          <span aria-hidden="true">×</span>
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
          <span aria-hidden="true">×</span>
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
