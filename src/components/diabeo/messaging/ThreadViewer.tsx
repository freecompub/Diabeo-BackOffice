"use client"

/**
 * ThreadViewer — viewer messages d'un thread avec composer (US-2076-UI iter 3).
 *
 * **Fetch** : `useThreadMessages({ conversationKey })` polling 30s + cursor
 * pagination "loadMore" vers le HAUT (messages anciens).
 *
 * **Send** : `useSendMessage()` optimistic UI — message apparait
 * immédiatement avec status "sending" → "sent" après 201 / rollback si fail.
 *
 * **Read receipts** : `useMarkAsRead()` auto-mark on scroll quand message
 * visible (IntersectionObserver). Idempotent — dedup côté hook.
 *
 * **UI** :
 *   - Header : nom anonymisé "Patient #N" + close mobile (iter 4 actions)
 *   - Messages list : bubbles vertes (envoyées par moi) vs blanc (reçues)
 *     avec timestamp + status (envoyé / lu il y a Xmin)
 *   - Composer : textarea auto-grow (max 8 lignes) + bouton Envoyer
 *     + cap 8164 bytes UTF-8 + Cmd/Ctrl+Enter shortcut
 *
 * **A11y** :
 *   - `<section>` parent avec aria-label
 *   - `aria-live="polite"` sur container messages (annonce nouveau)
 *   - `aria-busy` pendant load / send
 *   - Touch targets ≥ 44px composer + send button
 *   - Status messages SR-only ("envoyé", "lu")
 *
 * **Sécurité** :
 *   - body messages déchiffrés server-side (PHI Art. 9)
 *   - Cache-Control no-store via middleware /messages (Fix C2 PR #440)
 *   - Aucun bodyPreview dans aria-label discriminant (single-source visible)
 *   - currentUserId discriminator from-me vs received
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import type { Locale } from "@/i18n/config"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Send, Loader2 } from "lucide-react"
import { formatRelativeTime } from "@/lib/intl/formatters"
import { useThreadMessages, type ThreadMessageItem } from "./useThreadMessages"
import { useSendMessage } from "./useSendMessage"
import { useMarkAsRead } from "./useMarkAsRead"

const MAX_BODY_BYTES_UTF8 = 8164

export interface ThreadViewerProps {
  /** conversationKey du thread courant. null = aucun (render empty state). */
  conversationKey: string | null
  /** userId du pro connecté — discriminator from-me vs received. */
  currentUserId: number
  /** Callback post-send success (parent peut refetch threads list pour
   *  update preview + lastMessageAt + déplacer le thread en haut). */
  onMessageSent?: () => void
  /** Callback post-markRead (parent peut decrement unread badge global). */
  onMessageRead?: (messageId: string) => void
}

export function ThreadViewer({
  conversationKey,
  currentUserId,
  onMessageSent,
  onMessageRead,
}: ThreadViewerProps) {
  const t = useTranslations("messages")
  const locale = useLocale() as Locale

  const {
    messages,
    isInitialLoading,
    isLoadingMore,
    error,
    nextCursor,
    refetch,
    loadMore,
  } = useThreadMessages({ conversationKey })

  const sendHook = useSendMessage()
  const markHook = useMarkAsRead()

  // Optimistic messages — en attente de confirmation backend.
  // Le parent MessagingInbox passe `key={conversationKey}` au mount du
  // ThreadViewer, ce qui force un re-mount complet quand l'utilisateur
  // change de thread → tout state local (optimistic/composer/error) reset
  // automatiquement (React idiomatic, pas de useEffect setState).
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([])
  const [composerValue, setComposerValue] = useState<string>("")
  const [composerError, setComposerError] = useState<string | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  // Tri chronologique ascending (backend retourne DESC par recency).
  // Backend `getThread` retourne items DESC (plus récent en haut), donc
  // pour afficher en bas (chat-style), on reverse + concat optimistic.
  const renderedMessages = useMemo(() => {
    const ascending = [...messages].reverse()
    return [...ascending, ...optimisticMessages]
  }, [messages, optimisticMessages])

  // Auto-scroll bas quand nouveaux messages arrivent (ou send optimistic).
  // Skip si l'utilisateur a scrollé vers le haut (loadMore en cours).
  useEffect(() => {
    if (scrollContainerRef.current && !isLoadingMore) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [renderedMessages.length, isLoadingMore])

  // Auto-mark on scroll : marquer comme lu les messages reçus qui apparaissent
  // visiblement dans le viewport (IntersectionObserver).
  useEffect(() => {
    if (!scrollContainerRef.current || messages.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute("data-message-id")
            if (id) {
              void markHook.markAsRead(id).then((res) => {
                if (res.ok && onMessageRead) {
                  onMessageRead(id)
                }
              })
            }
          }
        }
      },
      { root: scrollContainerRef.current, threshold: 0.5 },
    )
    // Observe uniquement les messages reçus non-lus.
    const elements = scrollContainerRef.current.querySelectorAll<HTMLElement>(
      "[data-mark-on-view='true']",
    )
    elements.forEach((el) => observer.observe(el))
    return () => {
      observer.disconnect()
    }
  }, [messages, markHook, onMessageRead])

  // Composer : auto-grow textarea (max 8 lignes).
  useEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = "auto"
    const maxHeight = 8 * 24 // 8 lignes × ~24px line-height
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`
  }, [composerValue])

  // Validation byte length client-side (defense-in-depth, backend re-check).
  const composerByteLength = useMemo(() => {
    if (typeof TextEncoder === "undefined") return composerValue.length
    return new TextEncoder().encode(composerValue).length
  }, [composerValue])
  const isBodyTooLong = composerByteLength > MAX_BODY_BYTES_UTF8
  const canSend = composerValue.trim().length > 0 && !isBodyTooLong && !sendHook.loading

  // toUserId : extrait du dernier message reçu (premier qui n'est pas from-me).
  // Fallback : si tous les messages sont from-me, on prend le toUserId du
  // premier message envoyé.
  const toUserId = useMemo<number | null>(() => {
    for (const m of messages) {
      if (m.fromUserId !== currentUserId) return m.fromUserId
      // Si message from-me, le destinataire est dans toUserId.
      if (m.toUserId !== currentUserId) return m.toUserId
    }
    return null
  }, [messages, currentUserId])

  const handleSend = useCallback(async () => {
    if (!canSend || !toUserId) return
    const body = composerValue.trim()
    // Optimistic : append immédiatement avec status "sending".
    const tempId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic: OptimisticMessage = {
      tempId,
      fromUserId: currentUserId,
      toUserId,
      body,
      createdAt: new Date().toISOString(),
      status: "sending",
    }
    setOptimisticMessages((prev) => [...prev, optimistic])
    setComposerValue("")
    setComposerError(null)

    const result = await sendHook.send({ toUserId, body })
    if (result.ok) {
      // Remplacer optimistic par message réel (tempId → réel via refetch).
      setOptimisticMessages((prev) => prev.filter((m) => m.tempId !== tempId))
      void refetch()
      if (onMessageSent) onMessageSent()
    } else {
      // Rollback : marquer optimistic comme "failed" pour permettre retry.
      setOptimisticMessages((prev) =>
        prev.map((m) =>
          m.tempId === tempId ? { ...m, status: "failed", errorCode: result.code } : m,
        ),
      )
      setComposerError(`${result.code}`)
      // Restore composer value pour permettre retry rapide.
      setComposerValue(body)
    }
  }, [canSend, composerValue, currentUserId, toUserId, sendHook, refetch, onMessageSent])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd+Enter / Ctrl+Enter pour envoyer.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (canSend) void handleSend()
      }
    },
    [canSend, handleSend],
  )

  /* ─── Render ───────────────────────────────────────────────── */

  if (conversationKey === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        <p>{t("foundationPlaceholderEmpty")}</p>
      </div>
    )
  }

  if (error === "gdprConsentRevoked") {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        <p>{t("loadError")}</p>
      </div>
    )
  }

  if (error === "notFound") {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        <p>{t("threadNotFound")}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Messages list */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-2"
        aria-live="polite"
        aria-busy={isInitialLoading || sendHook.loading}
        aria-label={t("threadViewerLabel")}
      >
        {/* LoadMore button — top */}
        {nextCursor && (
          <div className="flex justify-center pb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadMore()}
              disabled={isLoadingMore}
              className="min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {isLoadingMore ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                t("loadMoreMessages")
              )}
            </Button>
          </div>
        )}

        {isInitialLoading ? (
          <div role="status" aria-busy="true" className="text-sm text-muted-foreground text-center py-4">
            {t("loading")}
          </div>
        ) : renderedMessages.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">
            <p>{t("threadEmptyNoMessage")}</p>
          </div>
        ) : (
          renderedMessages.map((m) => (
            <MessageBubble
              key={"tempId" in m ? m.tempId : m.id}
              message={m}
              currentUserId={currentUserId}
              locale={locale}
              labelSent={t("statusSent")}
              labelSending={t("statusSending")}
              labelFailed={t("statusFailed")}
              labelReadAt={(time: string) => t("statusReadAt", { time })}
            />
          ))
        )}

        {/* Stale-while-error banner (cohérent ThreadList) */}
        {error && messages.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="rounded-md border border-amber-600 bg-amber-50 p-2 text-xs text-amber-900"
          >
            {t("syncInterrupted")}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (canSend) void handleSend()
        }}
        className="border-t border-border p-3 flex items-end gap-2"
      >
        <div className="flex-1">
          <label htmlFor="composer-textarea" className="sr-only">
            {t("composerLabel")}
          </label>
          <textarea
            ref={textareaRef}
            id="composer-textarea"
            value={composerValue}
            onChange={(e) => {
              setComposerValue(e.target.value)
              setComposerError(null)
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={t("composerPlaceholder")}
            disabled={sendHook.loading}
            aria-invalid={isBodyTooLong || composerError !== null}
            aria-describedby={
              isBodyTooLong ? "composer-error-too-long" : composerError ? "composer-error-runtime" : undefined
            }
            className={cn(
              "w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              isBodyTooLong && "border-red-700 focus-visible:ring-red-700",
            )}
          />
          {/* Cap counter — affiché si > 80% du cap (visibilité progressive) */}
          {composerByteLength > MAX_BODY_BYTES_UTF8 * 0.8 && (
            <div
              id={isBodyTooLong ? "composer-error-too-long" : undefined}
              className={cn(
                "mt-1 text-xs",
                isBodyTooLong ? "text-red-700" : "text-muted-foreground",
              )}
              aria-live={isBodyTooLong ? "assertive" : "polite"}
            >
              {t("composerByteCount", { current: composerByteLength, max: MAX_BODY_BYTES_UTF8 })}
            </div>
          )}
          {composerError && !isBodyTooLong && (
            <div
              id="composer-error-runtime"
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              className="mt-1 text-xs text-red-700"
            >
              {t(composerErrorI18nKey(composerError))}
            </div>
          )}
        </div>
        <Button
          type="submit"
          variant="default"
          disabled={!canSend}
          aria-label={t("composerSendAria")}
          className="min-h-[44px] min-w-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          {sendHook.loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <>
              <Send className="h-4 w-4 me-1 rtl:rotate-180" aria-hidden="true" />
              <span className="hidden sm:inline">{t("composerSend")}</span>
            </>
          )}
        </Button>
      </form>
    </div>
  )
}

/* ─── Optimistic message type ─────────────────────────────────────── */

interface OptimisticMessage {
  tempId: string
  fromUserId: number
  toUserId: number
  body: string
  createdAt: string
  status: "sending" | "failed"
  errorCode?: string
}

function isOptimistic(m: ThreadMessageItem | OptimisticMessage): m is OptimisticMessage {
  return "tempId" in m
}

/* ─── Message Bubble ──────────────────────────────────────────────── */

interface MessageBubbleProps {
  message: ThreadMessageItem | OptimisticMessage
  currentUserId: number
  locale: Locale
  labelSent: string
  labelSending: string
  labelFailed: string
  labelReadAt: (time: string) => string
}

function MessageBubble({
  message,
  currentUserId,
  locale,
  labelSent,
  labelSending,
  labelFailed,
  labelReadAt,
}: MessageBubbleProps) {
  const isFromMe = message.fromUserId === currentUserId
  const optimistic = isOptimistic(message)

  let relativeTime = ""
  try {
    relativeTime = formatRelativeTime(message.createdAt, locale)
  } catch (err) {
    if (process.env.NODE_ENV !== "production" && err instanceof Error) {
      console.warn("[MessageBubble] formatRelativeTime failed:", err.message)
    }
  }

  // Status label : sending / failed / lu / envoyé.
  let statusLabel: string | null = null
  if (optimistic) {
    statusLabel = message.status === "sending" ? labelSending : labelFailed
  } else if (isFromMe && message.readAt) {
    try {
      const readTime = formatRelativeTime(message.readAt, locale)
      statusLabel = labelReadAt(readTime)
    } catch {
      statusLabel = labelSent
    }
  } else if (isFromMe) {
    statusLabel = labelSent
  }

  // Auto-mark on view : tag uniquement les messages REÇUS non-lus.
  const shouldAutoMark = !isFromMe && !optimistic && !message.readAt
  const messageId = optimistic ? message.tempId : message.id

  return (
    <div
      data-message-id={messageId}
      data-mark-on-view={shouldAutoMark ? "true" : undefined}
      className={cn("flex", isFromMe ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2 shadow-sm",
          isFromMe
            ? "bg-teal-700 text-white"
            : "bg-slate-100 text-slate-900",
          optimistic && message.status === "failed" && "border border-red-700",
        )}
      >
        <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
        <div
          className={cn(
            "mt-1 text-[10px]",
            isFromMe ? "text-teal-100" : "text-slate-600",
          )}
        >
          {relativeTime}
          {statusLabel && (
            <span className="ms-2">· {statusLabel}</span>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─── Helpers ────────────────────────────────────────────────────── */

function composerErrorI18nKey(code: string): string {
  switch (code) {
    case "forbidden":
      return "composerErrorForbidden"
    case "gdprConsentRevoked":
      return "composerErrorConsent"
    case "bodyTooLong":
      return "composerErrorTooLong"
    case "bodyEmpty":
      return "composerErrorEmpty"
    case "rateLimited":
      return "composerErrorRateLimited"
    case "networkError":
      return "composerErrorNetwork"
    default:
      return "composerErrorGeneric"
  }
}
