"use client"

/**
 * MemberFilter — dropdown filtre membre cabinet (stateless display).
 *
 * Fix CR-1 + H-4 round 2 review PR #432 — Composant **pur stateless**
 * qui reçoit `items` / `loading` / `error` du parent. Plus de `useEffect`
 * mutant le state parent (anti-pattern React "you might not need an
 * effect"). Plus de hook `useMyMemberships` propre → plus de double
 * fetch dû au remount entre branches return du parent.
 *
 * L'auto-select logic est désormais dans `<AppointmentCalendar>` qui
 * a la source of truth `useMyMemberships` + `manualMemberId`.
 *
 * Comportements selon nombre de memberships :
 *   - 0 → message "Pas de cabinet rattaché"
 *   - 1 → label statique "Dr X · Service Y"
 *   - ≥ 2 → dropdown Select shadcn (cas défensif US-2118 multi-cabinets V1.5)
 *
 * Loading state : skeleton avec `role="status"` + `aria-busy`.
 * Error state : badge `role="alert"` + bouton "Réessayer" (callback parent).
 *
 * Note L-1 review : `HealthcareMember.userId @unique` au schema actuel
 * garantit `items.length ≤ 1`. La branche ≥ 2 est défensive pour
 * US-2118 (praticiens libéraux multi-sites) si la contrainte unique
 * est levée plus tard.
 */

import { useTranslations } from "next-intl"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Membership } from "./useMyMemberships"

export interface MemberFilterProps {
  /** Liste des memberships fournie par le parent (lift state up H-4). */
  items: Membership[]
  /** Loading state du parent (initial fetch en cours). */
  loading: boolean
  /** Error state du parent (fetch failed). */
  error: string | null
  /** memberId sélectionné (controlled). */
  value: number | null
  /** Callback sélection changée. Doit avoir identity stable (setter ou useCallback). */
  onMemberChange: (memberId: number | null) => void
  /** Callback "Réessayer" si erreur (consume `refetch` du hook côté parent). */
  onRetry?: () => void
}

export function MemberFilter({
  items,
  loading,
  error,
  value,
  onMemberChange,
  onRetry,
}: MemberFilterProps) {
  const t = useTranslations("appointments")
  const tCommon = useTranslations("common")

  if (loading) {
    // Fix M-7 round 2 — `role="status"` + `aria-busy` + `aria-live`
    // pour annonce lecteur d'écran WCAG 2.1 SC 4.1.3.
    return (
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        aria-label={t("loading")}
        className="h-9 w-64 animate-pulse rounded-md bg-muted"
      />
    )
  }

  if (error) {
    return (
      <div role="alert" className="text-xs text-red-600 flex items-center gap-2">
        <span>{t("memberFilterError")}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="underline hover:no-underline"
          >
            {tCommon("retry")}
          </button>
        )}
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

  // ≥ 2 memberships — dropdown (cas défensif US-2118 multi-cabinets).
  return (
    <div className="flex items-center gap-2 text-sm">
      <label id="member-filter-label" className="text-muted-foreground">
        {t("memberLabel")} :
      </label>
      <Select
        value={value !== null ? String(value) : undefined}
        onValueChange={(v) => onMemberChange(Number(v))}
      >
        {/* Fix M-7 — `aria-labelledby` (vs `htmlFor` qui peut être consommé
            par un wrapper interne Base UI) + `aria-invalid` si error. */}
        <SelectTrigger
          id="member-filter"
          aria-labelledby="member-filter-label"
          aria-invalid={error !== null && error !== undefined ? "true" : undefined}
          className="w-72"
        >
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
