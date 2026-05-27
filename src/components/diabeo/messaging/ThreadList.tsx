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

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import type { Locale } from "@/i18n/config"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Search, XCircle, Plus } from "lucide-react"
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
  /**
   * Callback lors de la sélection d'un thread.
   * Fix C6 round 1 review PR #443 — `toUserId` propagé pour permettre au
   * parent (MessagingInbox) de le passer à ThreadViewer composer (thread
   * vide sendable).
   */
  onSelect: (key: string, toUserId: number | null) => void
  /**
   * Fix H5 round 1 review PR #441 — callback appelé si le thread sélectionné
   * disparaît du fetch (RGPD Art. 17 cascade, expiration). Le parent reset
   * son `selectedKey` à null pour éviter viewer orphelin sur conversationKey
   * mort.
   */
  onSelectedThreadVanished?: () => void
  /**
   * US-2076-UI iter 4 — callback button "+ Nouveau message" dans header.
   * Parent ouvre NewThreadModal. Si undefined, button non rendu.
   */
  onNewThread?: () => void
}

type ReadFilter = "all" | "unread"

export function ThreadList({
  currentUserId,
  selectedKey,
  onSelect,
  onSelectedThreadVanished,
  onNewThread,
}: ThreadListProps) {
  const t = useTranslations("messages")
  const locale = useLocale() as Locale

  const { threads, isInitialLoading, error, lastFetchedAt } = useMessageThreads()

  // Fix H5 round 1 review PR #441 — reset selectedKey si thread purgé du
  // fetch (RGPD Art. 17 cascade, expiration). Sans ça, le viewer affiche
  // un conversationKey orphelin → confusion médecin + audit incohérent
  // iter 3 (markRead 404 silencieux).
  useEffect(() => {
    if (isInitialLoading || error || !selectedKey || !onSelectedThreadVanished) return
    const stillExists = threads.some((t) => t.conversationKey === selectedKey)
    if (!stillExists) {
      onSelectedThreadVanished()
    }
  }, [threads, selectedKey, isInitialLoading, error, onSelectedThreadVanished])

  const [query, setQuery] = useState<string>("")
  // Fix M7 round 1 review PR #441 — `useDeferredValue` debounce naturel
  // React 18+ : keystroke met à jour query immédiatement (input contrôlé)
  // mais filteredThreads recompute avec retard (idle). Idiomatique React 19.
  const deferredQuery = useDeferredValue(query)
  const [readFilter, setReadFilter] = useState<ReadFilter>("all")

  // Filtre client-side (HMAC backend search reportée iter 4).
  // Scaling : OK ≤ 100 threads (limit backend). Au-delà : indexer Map +
  // virtualize (react-window) — voir Issue tracking iter 4.
  //
  // Fix M4 round 1 review PR #441 — `conversationKey` (HMAC hex 64char)
  // retiré du hayId : invisible côté UI donc jamais tapé volontairement,
  // mais peut générer faux positifs (ex: "abc" matche conversationKey
  // contenant "abc"). Match uniquement IDs publics visibles.
  const filteredThreads = useMemo(() => {
    let list = threads
    if (readFilter === "unread") {
      list = list.filter((t) => t.unreadCount > 0)
    }
    const q = deferredQuery.trim().toLowerCase()
    if (q.length > 0) {
      list = list.filter((t) => {
        const hayId = `${t.otherUserId} ${t.patientId ?? ""}`.toLowerCase()
        return hayId.includes(q)
      })
    }
    return list
  }, [threads, readFilter, deferredQuery])

  const totalCount = threads.length
  const unreadTotal = threads.reduce((sum, t) => sum + t.unreadCount, 0)

  // Fix M5 round 1 review PR #441 — labels stables pour `ThreadItem` memo.
  // Hoist depuis le parent (1 subscribe context next-intl vs N) + useCallback
  // pour ne pas casser areThreadItemsEqual (function ref change).
  const labelPreviewMe = t("previewPrefixMe")
  const labelUnreadAria = useCallback(
    (count: number) => t("itemUnreadAria", { count }),
    [t],
  )

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
  // Fix H4 round 1 review PR #441 — stale-while-error UX :
  // - Si error AND threads vide → full error screen (initial fetch failed)
  // - Si error AND threads non-vide → banner non-bloquant + threads stale
  //   (cohérent docstring "stale-while-error preserve last successful")
  const hasStaleData = threads.length > 0
  if (error && !hasStaleData) {
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
      {/* Header — title + new thread button + search + filtres */}
      <div className="border-b border-border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
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
          {/* US-2076-UI iter 4 — button "+ Nouveau message".
              Touch target 44px + focus ring + aria-label discriminant. */}
          {onNewThread && (
            <button
              type="button"
              onClick={onNewThread}
              data-testid="thread-list-new-button"
              aria-label={t("newThreadButtonAria")}
              className={cn(
                "inline-flex items-center justify-center rounded-md px-3 min-h-[44px] text-xs font-medium",
                "bg-teal-700 text-white hover:bg-teal-800",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              )}
            >
              <Plus className="h-4 w-4 me-1" aria-hidden="true" />
              <span className="hidden sm:inline">{t("newThreadButton")}</span>
            </button>
          )}
        </div>

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
            // Fix H10 round 1 review PR #441 — aria-label DIFFÉRENT du
            // placeholder (sinon NVDA/JAWS lit 2× la même valeur). aria-label
            // = description sémantique de l'action, placeholder = hint exemple.
            aria-label={t("searchAriaLabel")}
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => setQuery("")}
              // Fix L9 round 1 review PR #441 — touch target 44px (WCAG 2.5.5).
              // Le bouton garde sa position visuelle absolue dans le champ
              // search via `flex items-center justify-center` (centre l'icon).
              className="absolute end-1 top-1/2 -translate-y-1/2 flex items-center justify-center min-h-[44px] min-w-[44px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
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

      {/* Fix H4 round 1 review PR #441 — banner stale-while-error : si fetch
          échoue mais on a déjà des threads de la sync précédente, on garde
          la liste visible et on prévient l'utilisateur en haut. Plus utile
          UX (médecin garde contexte) que full-replace error screen. */}
      {error && hasStaleData && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mx-3 mt-2 rounded-md border border-amber-600 bg-amber-50 p-2 text-xs text-amber-900"
        >
          {t("syncInterrupted")}
        </div>
      )}

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
              // Fix M5 round 1 review PR #441 — hoist labels stables en props
              // (au lieu de `useTranslations` dans chaque ThreadItem memo).
              // Évite N subscriptions context i18n pour N items.
              labelPreviewMe={labelPreviewMe}
              labelUnreadAria={labelUnreadAria}
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
        // Fix H8 round 1 review PR #441 — touch target 44px (WCAG 2.5.5).
        // Médecin sur mobile risque mis-tap Tous vs Non lus avec 36px.
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors min-h-[44px] min-w-[44px]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        // Fix C1 + H9 round 1 review PR #441 — contrastes explicites WCAG AA 4.5:1.
        // bg-teal-700 = #0F766E (text-white = 6.5:1 ratio) vs ancien teal-600 (4.9:1 borderline).
        // bg-slate-100 + text-slate-800 = #F1F5F9/#1E293B (12.5:1) vs ancien bg-muted (Tailwind variable, borderline).
        active
          ? "bg-teal-700 text-white"
          : "bg-slate-100 text-slate-800 hover:bg-slate-200",
      )}
    >
      {label}
      {badge && (
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full px-1.5 min-w-[1.25rem] h-4 text-[10px] font-semibold",
            // Fix H9 round 1 review PR #441 — contraste filter actif badge.
            // bg-white + text-teal-900 (#134E4A) = 11.2:1 vs ancien teal-700 (4.9:1 borderline).
            active ? "bg-white text-teal-900" : "bg-red-700 text-white",
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
  onSelect: (key: string, toUserId: number | null) => void
  /** Fix M5 round 1 review PR #441 — labels en props (hoist depuis parent). */
  labelPreviewMe: string
  labelUnreadAria: (count: number) => string
}

const ThreadItem = memo(function ThreadItem({
  item,
  locale,
  isSelected,
  currentUserId,
  onSelect,
  labelPreviewMe,
  labelUnreadAria,
}: ThreadItemProps) {

  const displayName = getThreadDisplayName(item)
  const initials = getThreadAvatarInitials(item)

  // Timestamp relatif — try/catch defensive si locale invalide.
  let relativeTime: string
  try {
    relativeTime = formatRelativeTime(item.lastMessage.createdAt, locale)
  } catch (err) {
    // Fix L10 round 1 review PR #441 — log dev (silent en prod pour pas
    // spam console + pas leak via screenshots devtools).
    if (process.env.NODE_ENV !== "production" && err instanceof Error) {
      console.warn("[ThreadList] formatRelativeTime failed:", err.message)
    }
    relativeTime = ""
  }

  // Préfixe "Vous : " si je suis l'expéditeur du dernier message.
  const isFromMe = item.lastMessage.fromUserId === currentUserId
  const previewPrefix = isFromMe ? `${labelPreviewMe} ` : ""
  const previewSuffix = item.lastMessage.bodyPreviewTruncated ? "…" : ""

  return (
    <li role="listitem">
      <button
        type="button"
        onClick={() => onSelect(item.conversationKey, item.otherUserId)}
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
        {/* Avatar — Fix C2 + H3 round 1 review PR #441 :
            - text-teal-900 (#134E4A) sur teal-100 (#CCFBF1) = 8.7:1 (vs
              teal-700 borderline 4.57:1)
            - `dir="auto"` pour futur iter 3 si initiales mixed-language
              (ex: nom arabe "أ.م" lue RTL même en layout LTR) */}
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            item.patientId !== null
              ? "bg-teal-100 text-teal-900"
              : "bg-slate-200 text-slate-800",
          )}
          aria-hidden="true"
          dir="auto"
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
            {labelUnreadAria(item.unreadCount)}
          </span>
        )}
      </button>
    </li>
  )
}, areThreadItemsEqual)

/**
 * Fix H3 round 1 review PR #441 — custom areEqual pour `React.memo` car
 * le polling 60s renvoie un NOUVEAU array `threads` à chaque tick → shallow
 * compare default sur `item` prop échoue (nouvelle ref objet) → tous les
 * items re-render même si contenu identique. Pour 100 items × tick = vrai
 * coût.
 *
 * Compare uniquement les champs visuellement significatifs :
 *   - conversationKey (id stable)
 *   - lastMessage.id + createdAt + bodyPreview + isRead (changement texte / heure)
 *   - unreadCount (badge)
 *   - isSelected (background teal)
 *   - currentUserId (préfixe "Vous :" si fromUserId === currentUserId)
 *
 * Skip locale (next-intl rerender via Context si change) et onSelect (stable
 * via useCallback parent).
 */
function areThreadItemsEqual(prev: ThreadItemProps, next: ThreadItemProps): boolean {
  return (
    prev.item.conversationKey === next.item.conversationKey &&
    prev.item.lastMessage.id === next.item.lastMessage.id &&
    prev.item.lastMessage.createdAt === next.item.lastMessage.createdAt &&
    prev.item.lastMessage.bodyPreview === next.item.lastMessage.bodyPreview &&
    prev.item.lastMessage.bodyPreviewTruncated === next.item.lastMessage.bodyPreviewTruncated &&
    prev.item.lastMessage.isRead === next.item.lastMessage.isRead &&
    prev.item.lastMessage.fromUserId === next.item.lastMessage.fromUserId &&
    prev.item.unreadCount === next.item.unreadCount &&
    prev.item.patientId === next.item.patientId &&
    prev.isSelected === next.isSelected &&
    prev.currentUserId === next.currentUserId &&
    prev.locale === next.locale &&
    prev.labelPreviewMe === next.labelPreviewMe
    // labelUnreadAria : function ref — parent doit l'avoir stable via
    // useCallback OU on l'omet ici (recompute count → ICU plural).
  )
}
