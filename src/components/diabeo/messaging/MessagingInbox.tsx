"use client"

/**
 * MessagingInbox — shell 2-column responsive de la page `/messages`.
 *
 * US-2076-UI iter 1 (foundation) — uniquement structure layout + placeholder
 * `ThreadList` / `ThreadViewer`. Logique fetch + composer livrés en iter 2/3.
 *
 * **Layout** :
 *   - Desktop (>= 768px) : sidebar threads (320px fixe) + viewer (fill)
 *   - Mobile (< 768px) : list-then-thread, navigation via `selectedKey`
 *
 * **State** :
 *   - `selectedKey` (conversationKey | null) : thread courant ouvert
 *   - Si null sur mobile → afficher la liste
 *   - Si non-null sur mobile → afficher le viewer + bouton "back to list"
 *
 * **Sécurité** :
 *   - `conversationKey` reste client-only (jamais en URL Next.js Link →
 *     éviter leak Referer / browser history sur shared device)
 *   - Stocké dans useState local, propagé en prop au viewer
 *
 * **A11y** :
 *   - 2 landmarks : `<aside>` threads + `<section>` viewer (avec
 *     aria-label distincts)
 *   - aria-live="polite" sur viewer pour annoncer nouveaux messages (iter 3)
 *   - Touch targets ≥ 44px (composer iter 3)
 *
 * **iter 1 placeholders** : `ThreadList` + `ThreadViewer` rendent juste
 * "Coming in iter 2/3" — pas de fetch. La structure (responsive, a11y,
 * RTL) est complète et testée.
 */

import { useCallback, useState } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export interface MessagingInboxProps {
  userId: number
  userRole: "ADMIN" | "DOCTOR" | "NURSE"
}

export function MessagingInbox({ userId, userRole }: MessagingInboxProps) {
  const t = useTranslations("messages")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const handleSelectThread = useCallback((key: string | null) => {
    setSelectedKey(key)
  }, [])

  const handleBackToList = useCallback(() => {
    setSelectedKey(null)
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar threads — visible desktop toujours, mobile uniquement si !selectedKey */}
      <aside
        aria-label={t("threadListLabel")}
        className={cn(
          "h-full flex-col border-e border-border bg-card",
          // Mobile : caché si un thread est ouvert (mode list-then-thread)
          selectedKey === null ? "flex" : "hidden md:flex",
          "w-full md:w-80 md:shrink-0",
        )}
      >
        <ThreadListPlaceholder
          userId={userId}
          userRole={userRole}
          selectedKey={selectedKey}
          onSelect={handleSelectThread}
        />
      </aside>

      {/* Thread viewer — visible desktop toujours, mobile uniquement si selectedKey */}
      <section
        aria-label={t("threadViewerLabel")}
        className={cn(
          "h-full flex-1 flex-col",
          // Mobile : visible uniquement si un thread est sélectionné
          selectedKey !== null ? "flex" : "hidden md:flex",
        )}
      >
        {selectedKey !== null && (
          <div className="border-b border-border px-4 py-2 md:hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToList}
              className="min-h-[44px]"
              aria-label={t("backToList")}
            >
              <ArrowLeft className="h-4 w-4 me-1 rtl:rotate-180" aria-hidden="true" />
              {t("backToList")}
            </Button>
          </div>
        )}
        <ThreadViewerPlaceholder
          userId={userId}
          conversationKey={selectedKey}
        />
      </section>
    </div>
  )
}

/* ─── Placeholders iter 1 ───────────────────────────────────────── */

interface ThreadListPlaceholderProps {
  userId: number
  userRole: "ADMIN" | "DOCTOR" | "NURSE"
  selectedKey: string | null
  onSelect: (key: string | null) => void
}

function ThreadListPlaceholder({ userId, userRole, selectedKey, onSelect }: ThreadListPlaceholderProps) {
  const t = useTranslations("messages")
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <h2 className="text-base font-medium text-foreground">{t("threadListTitle")}</h2>
      </div>
      <div
        className="flex-1 overflow-y-auto p-4 text-sm text-muted-foreground"
        data-testid="thread-list-placeholder"
      >
        <p>{t("foundationPlaceholderList")}</p>
        {/* iter 2 démo navigation entre threads (sera remplacé par
            <ThreadList items={...} onSelect={onSelect} />) */}
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onSelect("demo-key-1")}
            className={cn(
              "rounded-md border border-border px-3 py-2 text-start text-sm transition-colors min-h-[44px]",
              selectedKey === "demo-key-1"
                ? "bg-teal-50 text-teal-700 border-teal-300"
                : "hover:bg-muted",
            )}
            aria-current={selectedKey === "demo-key-1" ? "true" : undefined}
          >
            {t("foundationPlaceholderDemoThread", { id: 1 })}
          </button>
          <button
            type="button"
            onClick={() => onSelect("demo-key-2")}
            className={cn(
              "rounded-md border border-border px-3 py-2 text-start text-sm transition-colors min-h-[44px]",
              selectedKey === "demo-key-2"
                ? "bg-teal-50 text-teal-700 border-teal-300"
                : "hover:bg-muted",
            )}
            aria-current={selectedKey === "demo-key-2" ? "true" : undefined}
          >
            {t("foundationPlaceholderDemoThread", { id: 2 })}
          </button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          {t("foundationContextUser", { userId, role: userRole })}
        </p>
      </div>
    </div>
  )
}

interface ThreadViewerPlaceholderProps {
  userId: number
  conversationKey: string | null
}

function ThreadViewerPlaceholder({ userId: _userId, conversationKey }: ThreadViewerPlaceholderProps) {
  const t = useTranslations("messages")
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
      {conversationKey === null ? (
        <p>{t("foundationPlaceholderEmpty")}</p>
      ) : (
        <p data-testid="thread-viewer-placeholder">
          {t("foundationPlaceholderViewer", { key: conversationKey })}
        </p>
      )}
    </div>
  )
}
