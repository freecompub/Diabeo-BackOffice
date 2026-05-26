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
import { ThreadList } from "./ThreadList"
import { ThreadViewer } from "./ThreadViewer"

export interface MessagingInboxProps {
  /**
   * userId du pro connecté. Conservé en prop pour iter 2 (filter "from
   * me" vs "to me" dans la liste threads + composer iter 3). Marked
   * unused `_userId` iter 1 (placeholder n'en a pas besoin).
   */
  userId: number
  userRole: "ADMIN" | "DOCTOR" | "NURSE"
}

export function MessagingInbox({ userId, userRole: _userRole }: MessagingInboxProps) {
  const t = useTranslations("messages")
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // Fix C6 round 1 review PR #443 — track toUserId du thread sélectionné
  // (résolu depuis ThreadSummary.otherUserId par ThreadList) → passé à
  // ThreadViewer pour permettre composer même si messages.length === 0.
  const [selectedToUserId, setSelectedToUserId] = useState<number | null>(null)

  const handleSelectThread = useCallback((key: string, toUserId: number | null) => {
    setSelectedKey(key)
    setSelectedToUserId(toUserId)
  }, [])

  const handleBackToList = useCallback(() => {
    setSelectedKey(null)
    setSelectedToUserId(null)
  }, [])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar threads — visible desktop toujours, mobile uniquement si !selectedKey */}
      {/* Fix H5 round 1 review PR #440 — `aria-labelledby` pointe vers
          le h2 enfant (single-source NVDA), au lieu de aria-label + h2
          duplication. Le h2 reste visible (heading level 2 sous h1 page). */}
      <aside
        aria-labelledby="messaging-thread-list-heading"
        className={cn(
          "h-full flex-col border-e border-border bg-card",
          // Mobile : caché si un thread est ouvert (mode list-then-thread)
          selectedKey === null ? "flex" : "hidden md:flex",
          "w-full md:w-80 md:shrink-0",
        )}
      >
        {/* US-2076-UI iter 2 — ThreadList branche fetch /api/messages réel
            polling 60s. Remplace `ThreadListPlaceholder` iter 1 (gardé en
            référence dans le fichier pour iter 3+ si besoin d'un mode
            offline / fallback réseau). */}
        <ThreadList
          currentUserId={userId}
          selectedKey={selectedKey}
          onSelect={handleSelectThread}
          // Fix H5 round 1 review PR #441 — reset selectedKey si thread
          // purgé backend entre 2 polls (RGPD Art. 17 cascade).
          onSelectedThreadVanished={handleBackToList}
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
              // Fix H6 round 1 review PR #440 — focus-visible explicite
              // pour RTL arabe (icône rotate-180, focus ring offset doit
              // être visible des deux côtés du texte).
              className="min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              aria-label={t("backToList")}
            >
              <ArrowLeft className="h-4 w-4 me-1 rtl:rotate-180" aria-hidden="true" />
              {t("backToList")}
            </Button>
          </div>
        )}
        {/* US-2076-UI iter 3 — ThreadViewer wire fetch /api/messages/thread/[key]
            + composer optimistic + read receipts auto-mark on scroll.
            `key={selectedKey}` force re-mount au changement de thread →
            tout state local (optimistic/composer/error) reset automatique
            (vs useEffect setState patterns flaggés react-hooks/set-state-in-effect). */}
        <ThreadViewer
          key={selectedKey ?? "__no-thread__"}
          conversationKey={selectedKey}
          currentUserId={userId}
          toUserId={selectedToUserId}
        />
      </section>
    </div>
  )
}

