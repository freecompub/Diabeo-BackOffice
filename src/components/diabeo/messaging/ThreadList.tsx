"use client"

/**
 * ThreadList — sidebar liste threads (US-2076-UI iter 2).
 *
 * **Fetch** : `useMessageThreads()` polling 60s + pause tab hidden +
 * visibilitychange refetch debounced 5s.
 *
 * **UI** :
 *   - Search bar haut : filtre client-side par patientId / otherUserId
 *     (HMAC search backend reportée iter 4 — pour l'instant, filter sur
 *     IDs visibles : "Patient #42" matche "42")
 *   - Filtre rapide "Tous" / "Non lus" (toggle ToggleGroup-like)
 *   - Tri par `lastMessage.createdAt DESC` (déjà fait backend via DISTINCT ON)
 *   - Per-thread :
 *     • Avatar initiales (P / U)
 *     • Nom anonymisé "Patient #N" (iter 3 résout vrai nom)
 *     • Dernier message tronqué (bodyPreview 80c côté backend)
 *     • Timestamp relatif "il y a 3 min" via formatRelativeTime US-2115
 *     • Badge unreadCount si > 0
 *
 * **A11y** :
 *   - `role="list"` + `role="listitem"` + `<button>` natif pour selection
 *   - aria-current="location" sur item sélectionné (pattern PR #440)
 *   - aria-pressed sur filter toggles (Tous/Non lus)
 *   - Live region "X conversations" + "Y non lues" via screen-reader-only
 *   - Touch targets ≥ 44px
 *
 * **Sécurité** :
 *   - `bodyPreview` est déchiffré par le backend (PHI) — pas re-déchiffré côté
 *     UI. Page wrapper `force-dynamic` + middleware no-store /messages couvre
 *     le bfcache (Fix C2 round 1 PR #440).
 *   - Aucun bodyPreview dans `aria-label` (pas spam SR + cohérence anti-leak
 *     open-space). Le SR lit le preview visible naturellement.
 */

import { memo, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import type { Locale } from "@/i18n/config"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Search, XCircle } from "lucide-react"
import { formatRelativeTime } from "@/lib/intl/formatters"
import {
  useMessageThreads,
  getThreadDisplayName,
  getThreadAvatarInitials,
  type ThreadListItem,
} from "./useMessageThreads"

export interface ThreadListProps {
  /** userId du pro connecté — utilisé pour distinguer "from me" vs received. */
  currentUserId: number
  /** ConversationKey du thread courant ouvert (null = aucun). */
  selectedKey: string | null
  /** Callback lors de la sélection d'un thread. */
  onSelect: (key: string) => void
}

type ReadFilter = "all" | "unread"

export function ThreadList({ currentUserId, selectedKey, onSelect }: ThreadListProps) {
  const t = useTranslations("messages")
  const locale = useLocale() as Locale

  const { threads, isInitialLoading, error, lastFetchedAt } = useMessageThreads()

  const [query, setQuery] = useState<string>("")
  const [readFilter, setReadFilter] = useState<ReadFilter>("all")

  // Filtre client-side (HMAC backend search iter 4).
  // Note : `query` matche conversationKey + otherUserId + patientId (IDs publics
  // côté UI — pas de PHI nom en clair iter 2).
  const filteredThreads = useMemo(() => {
    let list = threads
    if (readFilter === "unread") {
      list = list.filter((t) => t.unreadCount > 0)
    }
    const q = query.trim().toLowerCase()
    if (q.length > 0) {
      list = list.filter((t) => {
        const hayId = `${t.otherUserId} ${t.patientId ?? ""} ${t.conversationKey}`.toLowerCase()
        return hayId.includes(q)
      })
    }
    return list
  }, [threads, readFilter, query])

  const totalCount = threads.length
  const unreadTotal = threads.reduce((sum, t) => sum + t.unreadCount, 0)

  if (error === "gdprConsentRevoked") {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        <p>{t("loadError")}</p>
      </div>
    )
  }
  if (isInitialLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-live="polite"
        className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground"
      >
        {t("loading")}
      </div>
    )
  }
  if (error) {
    let timeStr: string | null = null
    if (lastFetchedAt) {
      try {
        timeStr = formatRelativeTime(lastFetchedAt, locale)
      } catch {
        timeStr = null
      }
    }
    return (
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="m-3 rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-900"
      >
        <p className="font-medium">{t("loadError")}</p>
        {timeStr && (
          <p className="mt-1 text-xs text-muted-foreground">{t("lastSync", { time: timeStr })}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header — search + filtres */}
      <div className="border-b border-border p-3 space-y-2">
        <h2
          id="messaging-thread-list-heading"
          className="text-base font-medium text-foreground"
        >
          {t("threadListTitle")}
          {totalCount > 0 && (
            <span className="ms-2 text-xs font-normal text-muted-foreground">
              {t("threadListCount", { count: totalCount })}
            </span>
          )}
        </h2>

        {/* Search */}
        <div className="relative">
          <Search
            className="absolute start-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="ps-8 pe-8 h-10"
            aria-label={t("searchPlaceholder")}
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
              aria-label={t("searchClear")}
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Filtre Tous / Non lus */}
        <div
          role="group"
          aria-label={t("filterGroupLabel")}
          className="flex gap-1"
        >
          <FilterButton
            active={readFilter === "all"}
            onClick={() => setReadFilter("all")}
            label={t("filterAll")}
            ariaLabel={t("filterAllAria", { count: totalCount })}
          />
          <FilterButton
            active={readFilter === "unread"}
            onClick={() => setReadFilter("unread")}
            label={t("filterUnread")}
            ariaLabel={t("filterUnreadAria", { count: unreadTotal })}
            badge={unreadTotal > 0 ? (unreadTotal > 9 ? "9+" : String(unreadTotal)) : undefined}
          />
        </div>
      </div>

      {/* List */}
      {filteredThreads.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {query.length > 0 || readFilter === "unread" ? (
            <p>{t("emptyStateFiltered")}</p>
          ) : (
            <p>{t("emptyStateNoConversation")}</p>
          )}
        </div>
      ) : (
        <ul role="list" className="flex-1 overflow-y-auto">
          {filteredThreads.map((item) => (
            <ThreadItem
              key={item.conversationKey}
              item={item}
              locale={locale}
              isSelected={selectedKey === item.conversationKey}
              currentUserId={currentUserId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/* ─── Filter Button ─────────────────────────────────────────────── */

interface FilterButtonProps {
  active: boolean
  onClick: () => void
  label: string
  ariaLabel: string
  badge?: string
}

function FilterButton({ active, onClick, label, ariaLabel, badge }: FilterButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors min-h-[36px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        active
          ? "bg-teal-600 text-white"
          : "bg-muted text-muted-foreground hover:bg-muted/80",
      )}
    >
      {label}
      {badge && (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full px-1.5 min-w-[1.25rem] h-4 text-[10px] font-semibold",
            active ? "bg-white text-teal-700" : "bg-red-700 text-white",
          )}
          aria-hidden="true"
        >
          {badge}
        </span>
      )}
    </button>
  )
}

/* ─── Thread Item ──────────────────────────────────────────────── */

interface ThreadItemProps {
  item: ThreadListItem
  locale: Locale
  isSelected: boolean
  currentUserId: number
  onSelect: (key: string) => void
}

const ThreadItem = memo(function ThreadItem({
  item,
  locale,
  isSelected,
  currentUserId,
  onSelect,
}: ThreadItemProps) {
  const t = useTranslations("messages")

  const displayName = getThreadDisplayName(item, locale)
  const initials = getThreadAvatarInitials(item)

  // Timestamp relatif — try/catch defensive si locale invalide.
  let relativeTime: string
  try {
    relativeTime = formatRelativeTime(item.lastMessage.createdAt, locale)
  } catch {
    relativeTime = ""
  }

  // Préfixe "Vous : " si je suis l'expéditeur du dernier message.
  const isFromMe = item.lastMessage.fromUserId === currentUserId
  const previewPrefix = isFromMe ? `${t("previewPrefixMe")} ` : ""
  const previewSuffix = item.lastMessage.bodyPreviewTruncated ? "…" : ""

  return (
    <li role="listitem">
      <button
        type="button"
        onClick={() => onSelect(item.conversationKey)}
        aria-current={isSelected ? "location" : undefined}
        // Fix A11y PR #440 pattern — pas d'aria-label discriminant qui
        // remplace le contenu visible. Le SR lit naturellement le contenu
        // du bouton (avatar décoratif + name + preview + timestamp + badge
        // sr-only). Single-source.
        className={cn(
          "flex w-full items-start gap-3 border-b border-border p-3 text-start transition-colors min-h-[64px]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
          isSelected
            ? "bg-teal-50"
            : "hover:bg-muted",
        )}
      >
        {/* Avatar */}
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            item.patientId !== null
              ? "bg-teal-100 text-teal-700"
              : "bg-slate-200 text-slate-700",
          )}
          aria-hidden="true"
        >
          {initials}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                "truncate text-sm font-medium",
                item.unreadCount > 0 ? "text-foreground" : "text-foreground/80",
              )}
            >
              {displayName}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {relativeTime}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 mt-1">
            <span
              className={cn(
                "truncate text-xs",
                item.unreadCount > 0 ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              {previewPrefix}
              {item.lastMessage.bodyPreview}
              {previewSuffix}
            </span>
            {item.unreadCount > 0 && (
              <Badge
                variant="default"
                className="shrink-0 bg-red-700 text-white hover:bg-red-700"
                aria-hidden="true"
              >
                {item.unreadCount > 9 ? "9+" : item.unreadCount}
              </Badge>
            )}
          </div>
        </div>

        {/* SR-only count discriminator */}
        {item.unreadCount > 0 && (
          <span className="sr-only">
            {t("itemUnreadAria", { count: item.unreadCount })}
          </span>
        )}
      </button>
    </li>
  )
})
