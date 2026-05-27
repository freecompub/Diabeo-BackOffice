"use client"

/**
 * NewThreadModal — modal "+ Nouveau message" (US-2076-UI iter 4).
 *
 * Permet au PS de commencer une nouvelle conversation avec un patient
 * autorisé (via `canMessage` backend re-vérifié au POST).
 *
 * **UI** :
 *   - Dialog shadcn (base-ui v1.3) avec aria-labelledby + aria-describedby
 *   - Search input filtre la liste contacts client-side (HMAC backend V2)
 *   - Liste scrollable + selection radio-style
 *   - Composer textarea (auto-grow + cap 8164 bytes UTF-8)
 *   - Bouton Envoyer disabled tant que (no contact selected || no body)
 *
 * **Sécurité** :
 *   - Backend `/api/messages` POST re-vérifie `canMessage` ⇒ pas d'IDOR
 *     possible même si UI corrompue
 *   - body max enforced via `MAX_BODY_BYTES_UTF8` (shared module iter 3)
 *   - autocomplete=off + spellcheck=false sur textarea (cohérent iter 3)
 *   - Pas de PHI dans aria-label (single-source visible)
 *
 * **A11y** :
 *   - aria-labelledby="new-thread-modal-title"
 *   - aria-describedby="new-thread-modal-desc"
 *   - Focus trap natif Dialog
 *   - Contact list `role="radiogroup"` + items `role="radio"` aria-checked
 *   - Send button aria-busy pendant POST + min-h-44px
 *   - Composer textarea dir="auto" RTL-safe
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Search, Send, Loader2, XCircle } from "lucide-react"
import { MAX_BODY_BYTES_UTF8 } from "@/lib/shared/messaging-bounds"
import { composerErrorI18nKey } from "@/lib/ui/messaging-error-keys"
import { useMessagingContacts } from "./useMessagingContacts"
import { useSendMessage, type SendMessageErrorCode } from "./useSendMessage"

export interface NewThreadModalProps {
  /** Open/close controlled par parent. */
  open: boolean
  onClose: () => void
  /**
   * Callback post-send success — parent peut refetch threads list +
   * sélectionner le nouveau thread (conversationKey retourné dans dto).
   */
  onMessageSent: (conversationKey: string, toUserId: number) => void
}

export function NewThreadModal({ open, onClose, onMessageSent }: NewThreadModalProps) {
  const t = useTranslations("messages")

  const { contacts, isLoading, error: contactsError } = useMessagingContacts({ skip: !open })
  const sendHook = useSendMessage()

  const [query, setQuery] = useState<string>("")
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [bodyValue, setBodyValue] = useState<string>("")
  const [composerError, setComposerError] = useState<SendMessageErrorCode | null>(null)

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  // Fix H1 round 1 review PR #444 — guard race condition close pendant send
  // in-flight. Si user clique Cancel/X pendant POST, on flag closedRef pour
  // ignorer le `onMessageSent` callback au resolve de la promise (sinon
  // parent bascule sur thread alors que modal fermée + risque setState
  // sur composant unmounted).
  const closedDuringSendRef = useRef<boolean>(false)

  // Filtre contacts client-side (cohérent ThreadList iter 2 — patientId / userId).
  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length === 0) return contacts
    return contacts.filter((c) => {
      const hay = `${c.patientId} ${c.userId} ${c.displayName}`.toLowerCase()
      return hay.includes(q)
    })
  }, [contacts, query])

  // Validation byte length (cohérent ThreadViewer iter 3 fix M2).
  const bodyByteLength = useMemo(() => {
    if (bodyValue.length <= 2000 && /^[\x00-\x7F]*$/.test(bodyValue)) {
      return bodyValue.length
    }
    if (typeof TextEncoder === "undefined") return bodyValue.length
    return new TextEncoder().encode(bodyValue).length
  }, [bodyValue])
  const isBodyTooLong = bodyByteLength > MAX_BODY_BYTES_UTF8
  const canSend =
    selectedUserId !== null &&
    bodyValue.trim().length > 0 &&
    !isBodyTooLong &&
    !sendHook.loading

  // Auto-grow textarea (cohérent ThreadViewer iter 3 fix H4 useLayoutEffect).
  useLayoutEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = "auto"
    const maxHeight = 8 * 24
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`
  }, [bodyValue])

  // Reset state quand modal close (parent doit toggle open=false).
  // Note : useLayoutEffect non requis ici car pas de DOM mutation visible.
  const handleClose = useCallback(() => {
    // Fix H1 round 1 review PR #444 — flag closedRef si fermeture pendant
    // send in-flight (sendHook.loading=true). Le handleSend ignorera le
    // onMessageSent callback au resolve.
    if (sendHook.loading) {
      closedDuringSendRef.current = true
    }
    setQuery("")
    setSelectedUserId(null)
    setBodyValue("")
    setComposerError(null)
    sendHook.reset()
    onClose()
  }, [onClose, sendHook])

  const handleSend = useCallback(async () => {
    if (!canSend || selectedUserId === null) return
    const body = bodyValue.trim()
    closedDuringSendRef.current = false // reset au début de chaque send
    const result = await sendHook.send({ toUserId: selectedUserId, body })
    // Fix H1 round 1 — si modal fermée pendant le send, on ignore le
    // callback (backend a peut-être créé le message — UX confuse vs
    // intent user qui a annulé). User devra refresh threads list pour
    // voir le message envoyé.
    if (closedDuringSendRef.current) {
      closedDuringSendRef.current = false
      return
    }
    if (result.ok) {
      onMessageSent(result.data.conversationKey, selectedUserId)
      handleClose()
    } else {
      setComposerError(result.code)
    }
  }, [canSend, selectedUserId, bodyValue, sendHook, onMessageSent, handleClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (canSend) void handleSend()
      }
    },
    [canSend, handleSend],
  )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent
        className="sm:max-w-lg"
        aria-labelledby="new-thread-modal-title"
        aria-describedby="new-thread-modal-desc"
      >
        <DialogHeader>
          <DialogTitle id="new-thread-modal-title">{t("newThreadTitle")}</DialogTitle>
          <DialogDescription id="new-thread-modal-desc">
            {t("newThreadDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Search contacts */}
          <div className="relative">
            <Search
              className="absolute start-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("newThreadSearchPlaceholder")}
              className="ps-8 pe-8 h-10"
              aria-label={t("newThreadSearchAriaLabel")}
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("searchClear")}
                className="absolute end-1 top-1/2 -translate-y-1/2 flex items-center justify-center min-h-[44px] min-w-[44px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
              >
                <XCircle className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Contacts list */}
          {isLoading ? (
            <div
              role="status"
              aria-busy="true"
              aria-live="polite"
              className="flex items-center justify-center p-6 text-sm text-muted-foreground"
            >
              {t("newThreadLoadingContacts")}
            </div>
          ) : contactsError ? (
            <div
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              className="rounded-md border border-red-700 bg-red-50 p-3 text-sm text-red-900"
            >
              {t(
                contactsError === "forbidden"
                  ? "newThreadErrorForbidden"
                  : "newThreadErrorLoad",
              )}
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {query.length > 0 ? t("newThreadNoMatch") : t("newThreadNoContacts")}
            </div>
          ) : (
            <ul
              role="radiogroup"
              aria-label={t("newThreadContactListLabel")}
              className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border"
            >
              {filteredContacts.map((contact, index) => {
                const isSelected = selectedUserId === contact.userId
                // Fix C4 + H6 + M9 round 1 review PR #444 — WAI-ARIA Radio
                // Group pattern :
                //   - Arrow Up/Down navigation entre radios + wrap
                //   - Home/End first/last
                //   - Space/Enter pour cocher
                //   - Roving tabindex : tabIndex=0 sur selected (ou first
                //     si aucun sélection), tabIndex=-1 sur autres
                //   - aria-label discriminant (cohérent A11y H3 — context
                //     "patient X" pour SR)
                const isRovingFocus =
                  selectedUserId === null ? index === 0 : isSelected
                return (
                  <li key={contact.userId} role="presentation">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      aria-label={t("newThreadContactRadioAria", {
                        name: contact.displayName,
                        id: contact.patientId,
                      })}
                      tabIndex={isRovingFocus ? 0 : -1}
                      onClick={() => setSelectedUserId(contact.userId)}
                      onKeyDown={(e) => {
                        // Space/Enter → check (M9)
                        if (e.key === " " || e.key === "Enter") {
                          e.preventDefault()
                          setSelectedUserId(contact.userId)
                          return
                        }
                        // Arrow nav (C4 WCAG 2.1.1)
                        let nextIndex: number | null = null
                        if (e.key === "ArrowDown") {
                          nextIndex = (index + 1) % filteredContacts.length
                        } else if (e.key === "ArrowUp") {
                          nextIndex =
                            (index - 1 + filteredContacts.length) % filteredContacts.length
                        } else if (e.key === "Home") {
                          nextIndex = 0
                        } else if (e.key === "End") {
                          nextIndex = filteredContacts.length - 1
                        }
                        if (nextIndex !== null) {
                          e.preventDefault()
                          const next = filteredContacts[nextIndex]
                          if (next) {
                            setSelectedUserId(next.userId)
                            // Focus le next radio (roving tabindex).
                            // querySelector via parent ul (race-safe :
                            // c'est le même DOM tree).
                            const nextEl = e.currentTarget.parentElement
                              ?.parentElement?.querySelectorAll<HTMLButtonElement>(
                                'button[role="radio"]',
                              )[nextIndex]
                            nextEl?.focus()
                          }
                        }
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 p-3 text-start transition-colors min-h-[44px]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                        isSelected ? "bg-teal-50" : "hover:bg-muted",
                      )}
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-900 text-xs font-semibold"
                        aria-hidden="true"
                        dir="auto"
                      >
                        P
                      </span>
                      <span className="flex-1 truncate text-sm">{contact.displayName}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Composer */}
          <div className="flex flex-col gap-1">
            <label htmlFor="new-thread-body" className="sr-only">
              {t("composerLabel")}
            </label>
            {/* Fix H8 round 1 review PR #444 — hint visible sous textarea
                (voice-control Dragon users perdent placeholder au focus). */}
            <p
              id="new-thread-body-hint"
              className="text-xs text-muted-foreground mb-1"
            >
              {t("composerHint")}
            </p>
            <textarea
              ref={textareaRef}
              id="new-thread-body"
              value={bodyValue}
              onChange={(e) => {
                setBodyValue(e.target.value)
                setComposerError(null)
              }}
              onKeyDown={handleKeyDown}
              rows={3}
              placeholder={t("composerPlaceholder")}
              disabled={sendHook.loading}
              dir="auto"
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
              aria-invalid={isBodyTooLong || composerError !== null}
              aria-describedby={
                isBodyTooLong
                  ? "new-thread-body-error-toolong"
                  : composerError
                    ? "new-thread-body-error-runtime"
                    : undefined
              }
              className={cn(
                "w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                isBodyTooLong && "border-red-700 focus-visible:ring-red-700",
              )}
            />
            {bodyByteLength > MAX_BODY_BYTES_UTF8 * 0.8 && (
              <div
                id={isBodyTooLong ? "new-thread-body-error-toolong" : undefined}
                // Fix M10 round 1 review PR #444 — role="status" toujours
                // (vs alternance status/alert qui confusait SR). Urgency
                // exprimée via aria-live="assertive" + texte rouge visuel.
                role="status"
                aria-live={isBodyTooLong ? "assertive" : "polite"}
                aria-atomic="true"
                className={cn(
                  "text-xs",
                  isBodyTooLong ? "text-red-700" : "text-muted-foreground",
                )}
              >
                {t("composerByteCount", { current: bodyByteLength, max: MAX_BODY_BYTES_UTF8 })}
              </div>
            )}
            {composerError && !isBodyTooLong && (
              <div
                id="new-thread-body-error-runtime"
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                className="text-xs text-red-700"
              >
                {t(composerErrorI18nKey(composerError))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            type="button"
            onClick={handleClose}
            disabled={sendHook.loading}
          >
            {t("actionCancel")}
          </Button>
          <Button
            variant="default"
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            aria-busy={sendHook.loading}
            aria-label={t("composerSendAria")}
            className="min-h-[44px] min-w-[44px]"
          >
            {sendHook.loading ? (
              <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <>
                <Send className="h-4 w-4 me-1 rtl:rotate-180" aria-hidden="true" />
                {t("composerSend")}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Fix M1 round 1 review PR #444 — `composerErrorI18nKey` factor dans
// `@/lib/ui/messaging-error-keys` (shared avec ThreadViewer iter 3).
