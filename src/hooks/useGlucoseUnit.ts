/**
 * @module hooks/useGlucoseUnit
 * @description Hook client exposant l'unité d'affichage de la glycémie de
 * l'utilisateur COURANT (`UserUnitPreferences.unitGlycemia`) + des formateurs
 * prêts à l'emploi, locale-aware (ADR #32 — couche présentation, US-3248).
 *
 * L'unité canonique de transport/stockage est **g/L** ; ce hook convertit pour
 * l'AFFICHAGE selon la préférence (3=g/L, 4=mg/dL, 5=mmol/L). Les données de
 * charts/analytics arrivant en mg/dL (repère clinique), les formateurs prennent
 * du **mg/dL** en entrée et délèguent la conversion au module `glucose/units`.
 *
 * Défaut = **mg/dL** tant que la préférence n'est pas chargée (parité avec le
 * comportement historique des dashboards ; cf. `glucoseUnitFromCode`).
 *
 * @example
 * const g = useGlucoseUnit()
 * <span>{g.format(180)}</span>   // "180 mg/dL" | "1,80 g/L" | "10 mmol/L"
 * <YAxis tickFormatter={g.value} /> // nombre converti, sans libellé
 */

"use client"

import { useEffect, useMemo, useState } from "react"
import { useFormatters } from "@/hooks/useFormatters"
import type { GlucoseUnit, NumberFormatOptions } from "@/lib/intl/formatters"
import {
  type GlucoseUnitCode,
  type GlucoseUnitLabel,
  glucoseUnitLabel,
  mgdlToDisplayValue,
} from "@/lib/glucose/units"

/** Mappe le code `unitGlycemia` (3/4/5) vers l'unité des formateurs i18n. */
function codeToGlucoseUnit(code: GlucoseUnitCode): GlucoseUnit {
  switch (code) {
    case 3:
      return "gl"
    case 5:
      return "mmoll"
    case 4:
    default:
      return "mgdl"
  }
}

/** Valide un code d'unité glycémie inconnu → défaut mg/dL (fail-safe). */
function normalizeCode(raw: unknown): GlucoseUnitCode {
  return raw === 3 || raw === 5 ? raw : 4
}

export interface UseGlucoseUnit {
  /** Code de préférence courant (3=g/L, 4=mg/dL, 5=mmol/L). */
  code: GlucoseUnitCode
  /** Unité des formateurs i18n (`"gl" | "mgdl" | "mmoll"`). */
  unit: GlucoseUnit
  /** Libellé affichable de l'unité (`"g/L" | "mg/dL" | "mmol/L"`). */
  label: GlucoseUnitLabel
  /** `true` une fois la préférence chargée (avant : défaut mg/dL). */
  ready: boolean
  /** Formate une valeur **mg/dL** → chaîne locale + libellé (ex. "1,80 g/L"). */
  format: (mgdl: number, opts?: NumberFormatOptions) => string
  /** Convertit une valeur **mg/dL** → nombre d'affichage (sans libellé). */
  value: (mgdl: number) => number
}

/**
 * Récupère la préférence d'unité glycémie de l'utilisateur courant via
 * `GET /api/account/units` (une fois au montage) et expose des formateurs.
 */
export function useGlucoseUnit(): UseGlucoseUnit {
  const { glucose } = useFormatters()
  const [code, setCode] = useState<GlucoseUnitCode>(4)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/account/units", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data === "object") setCode(normalizeCode(data.unitGlycemia))
      })
      .catch(() => {
        // Réseau/annulation → on garde le défaut mg/dL (fail-safe, pas de throw).
      })
      .finally(() => setReady(true))
    return () => controller.abort()
  }, [])

  const unit = codeToGlucoseUnit(code)

  return useMemo(
    () => ({
      code,
      unit,
      label: glucoseUnitLabel(code),
      ready,
      format: (mgdl: number, opts?: NumberFormatOptions) => glucose(mgdl, unit, opts),
      value: (mgdl: number) => mgdlToDisplayValue(mgdl, code),
    }),
    [code, unit, ready, glucose],
  )
}
