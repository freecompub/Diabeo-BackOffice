"use client"

/**
 * MemberFilter — dropdown filtre membre cabinet pour US-2500-UI.
 *
 * Comportements selon nombre de memberships du user :
 *   - 0 membership → message "Pas de cabinet rattaché"
 *     (peut arriver pour ADMIN sans HealthcareMember row)
 *   - 1 membership → label statique "Dr Sophie Martin · CHU Paris"
 *     (pas de dropdown, info contextuelle uniquement)
 *   - ≥2 memberships → dropdown Select shadcn (cas rare multi-cabinets)
 *
 * Loading state : skeleton compact.
 * Error state : badge erreur + bouton réessayer.
 *
 * Émet `onMemberChange(memberId | null)` au parent. Le parent (`<AppointmentCalendar>`)
 * gère le state authority et le passe à `useAppointments({memberId})`.
 *
 * Auto-sélection au mount : si exactement 1 membership, fire
 * `onMemberChange(items[0].memberId)` immédiatement (évite que le parent
 * affiche "Sélectionnez un filtre" entre le mount et la sélection).
 */

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useMyMemberships } from "./useMyMemberships"

export interface MemberFilterProps {
  /** memberId sélectionné (controlled). */
  value: number | null
  /** Callback quand la sélection change (ou auto-set au mount). */
  onMemberChange: (memberId: number | null) => void
}

export function MemberFilter({ value, onMemberChange }: MemberFilterProps) {
  const t = useTranslations("appointments")
  const { items, loading, error } = useMyMemberships()

  // Auto-select unique membership au mount (cas dominant DOCTOR/NURSE).
  useEffect(() => {
    if (loading || error) return
    if (items.length === 1 && value === null) {
      onMemberChange(items[0].memberId)
    }
  }, [items, loading, error, value, onMemberChange])

  if (loading) {
    return (
      <div
        className="h-9 w-64 animate-pulse rounded-md bg-muted"
        aria-label={t("loading")}
      />
    )
  }

  if (error) {
    return (
      <div role="alert" className="text-xs text-red-600">
        {t("memberFilterError")}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        {t("noMembership")}
      </div>
    )
  }

  // 1 seul membership — affichage statique sans dropdown.
  if (items.length === 1) {
    const m = items[0]
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{t("memberLabel")} :</span>
        <span className="font-medium">{m.memberName}</span>
        <span className="text-xs text-muted-foreground">· {m.serviceName}</span>
      </div>
    )
  }

  // ≥ 2 memberships — dropdown.
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="member-filter" className="text-muted-foreground">
        {t("memberLabel")} :
      </label>
      <Select
        value={value !== null ? String(value) : undefined}
        onValueChange={(v) => onMemberChange(Number(v))}
      >
        <SelectTrigger id="member-filter" className="w-72">
          <SelectValue placeholder={t("memberPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {items.map((m) => (
            <SelectItem key={m.memberId} value={String(m.memberId)}>
              {m.memberName} · {m.serviceName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
