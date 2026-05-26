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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import type { Locale } from "@/i18n/config"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Send, Loader2 } from "lucide-react"
import { formatRelativeTime } from "@/lib/intl/formatters"
import { logHookError } from "@/lib/ui/sanitize-error"
import { MAX_BODY_BYTES_UTF8 } from "@/lib/shared/messaging-bounds"
import { useThreadMessages, type ThreadMessageItem } from "./useThreadMessages"
import { useSendMessage } from "./useSendMessage"
import { useMarkAsRead } from "./useMarkAsRead"

export interface ThreadViewerProps {
  /** conversationKey du thread courant. null = aucun (render empty state). */
  conversationKey: string | null
  /** userId du pro connecté — discriminator from-me vs received. */
  currentUserId: number
  /**
   * Fix C6 round 1 review PR #443 — `toUserId` du contact passé par le parent
   * (résolu depuis `ThreadSummary.otherUserId` iter 2). Permet d'envoyer le
   * premier message dans un thread vide (sans avoir à extraire d'un message
   * existant). null = pas de destinataire connu → composer disabled.
   */
  toUserId?: number | null
  /** Callback post-send success (parent peut refetch threads list pour
   *  update preview + lastMessageAt + déplacer le thread en haut). */
  onMessageSent?: () => void
  /** Callback post-markRead (parent peut decrement unread badge global). */
  onMessageRead?: (messageId: string) => void
}

/**
 * Fix C1 round 1 review PR #443 — IntersectionObserver consent légal.
 *
 * Backend `readAt` est un acte clinique opposable RGPD Art. 4(11) + CSP
 * Art. R.4127-32 (médecin = vu, doit responsable). On durcit le trigger
 * pour éviter "lu accidentel" (resize, focus, polling) :
 *   - `threshold: 1.0` : message ENTIÈREMENT visible (vs 0.5 partial)
 *   - `dwell time: 1500ms` : message visible pendant au moins 1.5s
 *
 * Décision DPO documentée DPIA §iter 3 — `readAt` UI sémantique "vu" pas
 * "traité cliniquement". CGU pro doit clarifier.
 */
const MARK_AS_READ_THRESHOLD = 1.0
const MARK_AS_READ_DWELL_MS = 1500

export function ThreadViewer({
  conversationKey,
  currentUserId,
  toUserId: toUserIdProp,
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
  // Fix C4 round 1 review PR #443 — `markHookRef` stable pour IntersectionObserver
  // deps. Sans ça, l'objet `markHook` (loading/error state) change ref à chaque
  // render → effect re-run + observer disconnect/reobserve à CHAQUE render.
  const markHookRef = useRef(markHook)
  const onMessageReadRef = useRef(onMessageRead)
  useEffect(() => {
    markHookRef.current = markHook
  }, [markHook])
  useEffect(() => {
    onMessageReadRef.current = onMessageRead
  }, [onMessageRead])

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

  // Auto-scroll bas — Fix C5 round 1 review PR #443 : ne PAS auto-scroll
  // si l'utilisateur a scrolé vers le haut pour lire un ancien message,
  // sinon polling tick / nouveau message reçu yank l'utilisateur vers
  // le bas pendant lecture. Pattern chat-UX standard.
  // Auto-scroll uniquement si l'utilisateur est déjà ≤ 100px du bas.
  const NEAR_BOTTOM_THRESHOLD_PX = 100
  useEffect(() => {
    if (!scrollContainerRef.current || isLoadingMore) return
    const el = scrollContainerRef.current
    const isNearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [renderedMessages.length, isLoadingMore])

  // Auto-mark on scroll : marquer comme lu les messages reçus visibles.
  // Fix C1 round 1 review PR #443 — threshold 1.0 (vs 0.5) + dwell time
  // 1500ms pour éviter "lu accidentel" (resize, focus, polling tick).
  // `readAt` est un acte clinique opposable RGPD Art. 4(11).
  // Fix C4 round 1 review PR #443 — markHookRef stable (vs markHook
  // object instable qui recréait observer à chaque render).
  useEffect(() => {
    if (!scrollContainerRef.current || messages.length === 0) return
    // Track dwell timers par messageId pour annulation si user scroll
    // avant les 1500ms (message ne reste pas visible assez longtemps).
    const dwellTimers = new Map<string, ReturnType<typeof setTimeout>>()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-message-id")
          if (!id) continue
          if (entry.isIntersecting && entry.intersectionRatio >= MARK_AS_READ_THRESHOLD) {
            // Trigger dwell timer — si message reste visible 1500ms, markRead.
            if (!dwellTimers.has(id)) {
              const timer = setTimeout(() => {
                dwellTimers.delete(id)
                void markHookRef.current.markAsRead(id).then((res) => {
                  if (res.ok && onMessageReadRef.current) {
                    onMessageReadRef.current(id)
                  }
                })
              }, MARK_AS_READ_DWELL_MS)
              dwellTimers.set(id, timer)
            }
          } else {
            // Message sorti du viewport AVANT dwell complete → cancel.
            const timer = dwellTimers.get(id)
            if (timer) {
              clearTimeout(timer)
              dwellTimers.delete(id)
            }
          }
        }
      },
      { root: scrollContainerRef.current, threshold: MARK_AS_READ_THRESHOLD },
    )
    // Observe uniquement les messages reçus non-lus (data-mark-on-view=true).
    const elements = scrollContainerRef.current.querySelectorAll<HTMLElement>(
      "[data-mark-on-view='true']",
    )
    elements.forEach((el) => observer.observe(el))
    return () => {
      observer.disconnect()
      for (const timer of dwellTimers.values()) clearTimeout(timer)
      dwellTimers.clear()
    }
  }, [messages])

  // Composer auto-grow textarea (max 8 lignes).
  // Fix H4 round 1 review PR #443 — `useLayoutEffect` (vs `useEffect`)
  // pour sync pré-paint et éviter flicker (textarea hauteur défaut puis
  // recalcul après render).
  useLayoutEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = "auto"
    const maxHeight = 8 * 24 // 8 lignes × ~24px line-height
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`
  }, [composerValue])

  // Validation byte length client-side (defense-in-depth, backend re-check).
  // Fix M2 round 1 review PR #443 — short-circuit si pure-ASCII <= 2000 chars
  // (chars ≤ bytes UTF-8 always pour ASCII). Évite encode 8KB par keystroke
  // sur textareas longs (composer médical peut être verbeux).
  const composerByteLength = useMemo(() => {
    // Pure ASCII shortcut : aucun char > 0x7F → bytes === chars.
    if (composerValue.length <= 2000 && /^[\x00-\x7F]*$/.test(composerValue)) {
      return composerValue.length
    }
    if (typeof TextEncoder === "undefined") return composerValue.length
    return new TextEncoder().encode(composerValue).length
  }, [composerValue])
  const isBodyTooLong = composerByteLength > MAX_BODY_BYTES_UTF8
  const canSend = composerValue.trim().length > 0 && !isBodyTooLong && !sendHook.loading

  // Fix C6 round 1 review PR #443 — toUserId DOIT venir du parent (résolu
  // depuis ThreadSummary.otherUserId iter 2). Sans ça :
  //   - Thread vide (messages.length === 0) → composer impossible à envoyer
  //   - Le 1er message envoyé devient impossible (no message to extract from)
  // Fallback (extraction depuis messages) si prop absente — defense-in-depth.
  const toUserId = useMemo<number | null>(() => {
    if (toUserIdProp !== undefined && toUserIdProp !== null) return toUserIdProp
    for (const m of messages) {
      if (m.fromUserId !== currentUserId) return m.fromUserId
      if (m.toUserId !== currentUserId) return m.toUserId
    }
    return null
  }, [toUserIdProp, messages, currentUserId])

  const handleSend = useCallback(async () => {
    if (!canSend || !toUserId) return
    const body = composerValue.trim()
    // Optimistic : append immédiatement avec status "sending".
    // Fix H2 round 1 review PR #443 — `crypto.randomUUID()` standard
    // browser (Node 18+ + tous browsers depuis 2021) → 0 collision possible
    // vs ancien Date.now()+Math.random(6 chars) qui pouvait colliser sur
    // sends concurrents même ms (duplicate React keys → render incorrect).
    const tempId = `optimistic-${
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    }`
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
      // Fix M6 round 1 review PR #443 — restore composer value pour
      // permettre retry rapide, MAIS uniquement si l'utilisateur n'a pas
      // commencé à retaper entre-temps (overwrite frustrant).
      setComposerValue((current) => (current.length === 0 ? body : current))
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
        {/* LoadMore button — top.
            Fix H13 round 1 review PR #443 — aria-label discriminant pendant
            loading (sinon SR ne lit que Loader2 icon vide).
            Fix H9 round 1 — motion-safe:animate-spin pour respecter
            prefers-reduced-motion (utilisateurs vestibulaire). */}
        {nextCursor && (
          <div className="flex justify-center pb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadMore()}
              disabled={isLoadingMore}
              aria-busy={isLoadingMore}
              aria-label={isLoadingMore ? t("loadingMore") : t("loadMoreMessages")}
              className="min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {isLoadingMore ? (
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
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
              labelArticleSenderMe={t("articleSenderMe")}
              labelArticleSenderOther={t("articleSenderOther")}
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
            // Fix H11 round 1 review PR #443 — `dir="auto"` aligne le
            // texte arabe/RTL correctement même en layout LTR (le browser
            // détecte la direction depuis le 1er char strong).
            dir="auto"
            // Fix M4 round 1 review PR #443 — anti spell-check tiers (Chrome
            // → Google, Safari → Apple) + auto-fill history poste partagé.
            // RGPD Art. 28 sous-traitants : pas d'envoi texte clinique à
            // service externe sans DPA. data-1p-ignore/data-lpignore =
            // 1Password/LastPass anti-suggestion.
            autoComplete="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
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
          {/* Cap counter — affiché si > 80% du cap (visibilité progressive).
              Fix H12 round 1 review PR #443 — `aria-atomic="true"` + role=status
              pour que NVDA/JAWS re-vocalise le full content (vs grouping 400ms
              qui peut merger annonces successives). */}
          {composerByteLength > MAX_BODY_BYTES_UTF8 * 0.8 && (
            <div
              id={isBodyTooLong ? "composer-error-too-long" : undefined}
              role={isBodyTooLong ? "alert" : "status"}
              aria-live={isBodyTooLong ? "assertive" : "polite"}
              aria-atomic="true"
              className={cn(
                "mt-1 text-xs",
                isBodyTooLong ? "text-red-700" : "text-muted-foreground",
              )}
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
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
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
  /** Fix C2 round 1 review PR #443 — aria-label discriminant sender. */
  labelArticleSenderMe: string
  labelArticleSenderOther: string
}

function MessageBubble({
  message,
  currentUserId,
  locale,
  labelSent,
  labelSending,
  labelFailed,
  labelReadAt,
  labelArticleSenderMe,
  labelArticleSenderOther,
}: MessageBubbleProps) {
  const isFromMe = message.fromUserId === currentUserId
  const optimistic = isOptimistic(message)

  let relativeTime = ""
  try {
    relativeTime = formatRelativeTime(message.createdAt, locale)
  } catch (err) {
    // Fix H7 round 1 review PR #443 — helper sanitize + log gated NODE_ENV.
    logHookError("MessageBubble.formatRelativeTime", err)
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

  // Fix C2 round 1 review PR #443 — Message bubble role + aria-label
  // discriminant sender (sinon SR perd contexte expéditeur sur thread long).
  // Fix C3 round 1 review PR #443 — Séparateur `·` lu littéralement par
  // NVDA "point envoyé". Wrap status+timestamp dans `aria-label` combiné.
  const ariaSender = isFromMe ? labelArticleSenderMe : labelArticleSenderOther
  const statusAriaLabel = statusLabel ? `${relativeTime} ${statusLabel}` : relativeTime

  return (
    <article
      role="article"
      data-message-id={messageId}
      data-mark-on-view={shouldAutoMark ? "true" : undefined}
      aria-label={`${ariaSender} ${message.body} ${statusAriaLabel}`.trim()}
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
        {/* Fix C3 round 1 — separator `·` rendu aria-hidden, le sender +
            body + timestamp + status sont déjà lus via parent aria-label. */}
        <div
          aria-hidden="true"
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
    </article>
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
