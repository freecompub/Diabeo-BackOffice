"use client"

/**
 * SessionsSection — UI US-2007 Sessions multiples (Groupe 9 Admin/Ops).
 *
 * Affiche les sessions actives du user authentifié + permet de :
 *   - Révoquer une session distante (DELETE /api/account/sessions/[id])
 *   - Révoquer toutes les sessions sauf la courante (DELETE /api/account/sessions)
 *
 * Backend : `src/lib/services/session-management.service.ts` (US-2007 livré PR #409).
 * Pattern aligné avec autres sections du `/settings` page (PR #426).
 *
 * Fixes round 1 review PR #457 :
 *   - H1 : remplace `confirm()` natif par `<Dialog>` shadcn (i18n + a11y)
 *   - M2 : `formatRelativeTime` next-intl (US-2115) au lieu de helper FR hardcoded
 *   - M8 : error feedback inline `setActionError`
 *   - M8 : `setTimeout` cleanup via mounted ref (anti memory leak)
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale } from "next-intl"
import { Monitor, Smartphone, Tablet, Trash2, ShieldCheck, AlertCircle } from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { DiabeoFormSection } from "@/components/diabeo/DiabeoFormSection"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatRelativeTime } from "@/lib/intl/formatters"
import type { Locale } from "@/i18n/config"
import { Acronym } from "@/components/diabeo/Acronym"

interface SessionDTO {
  id: string
  isCurrent: boolean
  mfaVerified: boolean
  ipAddress: string | null
  userAgent: string | null
  createdAt: string // ISO from JSON
  lastSeenAt: string
  expires: string
}

type AsyncState = "idle" | "loading" | "success" | "error"

/**
 * Heuristique simple icône device basée sur le User-Agent.
 * Pas exhaustive — juste un signal visuel cohérent pour le PS.
 */
function getDeviceIcon(ua: string | null): typeof Monitor {
  if (!ua) return Monitor
  const lc = ua.toLowerCase()
  if (lc.includes("iphone") || lc.includes("android")) return Smartphone
  if (lc.includes("ipad") || lc.includes("tablet")) return Tablet
  return Monitor
}

/**
 * Extrait un nom court depuis le UA (best-effort, non-cryptographique).
 * Ex: "Mozilla/5.0 ... Chrome/127.0 ..." → "Chrome 127"
 */
function summarizeUserAgent(ua: string | null): string {
  if (!ua) return "Appareil inconnu"
  const browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/(\d+)/)
  if (browserMatch) return `${browserMatch[1]} ${browserMatch[2]}`
  return ua.slice(0, 40)
}

export function SessionsSection() {
  const locale = useLocale() as Locale
  const [sessions, setSessions] = useState<SessionDTO[]>([])
  const [state, setState] = useState<AsyncState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [revokeAllState, setRevokeAllState] = useState<AsyncState>("idle")
  const [revokingIds, setRevokingIds] = useState<Set<string>>(new Set())
  // Fix H1 round 1 PR #457 — dialog confirmation pattern (vs confirm() natif).
  // `null` = closed ; string sessionId = revoke-one ; "all" = revoke-others.
  const [pendingConfirm, setPendingConfirm] = useState<string | "all" | null>(null)

  // Fix M8 round 1 — mountedRef + timer ref pour cleanup (anti memory leak
  // + React warning "set state on unmounted component").
  const mountedRef = useRef(true)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  const fetchSessions = useCallback(async () => {
    setState("loading")
    setErrorMessage(null)
    try {
      const res = await fetch("/api/account/sessions", { credentials: "include" })
      if (!mountedRef.current) return
      if (!res.ok) {
        setState("error")
        setErrorMessage(`HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { items?: SessionDTO[] }
      setSessions(data.items ?? [])
      setState("success")
    } catch (err) {
      if (!mountedRef.current) return
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [])

  useEffect(() => {
    void fetchSessions()
  }, [fetchSessions])

  // Fix H1 round 1 PR #457 — exécution de la révocation après confirmation
  // explicite via le Dialog shadcn. Fix M8 — error feedback inline.
  const executeRevokeOne = useCallback(
    async (sessionId: string) => {
      setActionError(null)
      setRevokingIds((prev) => new Set(prev).add(sessionId))
      try {
        const res = await fetch(`/api/account/sessions/${sessionId}`, {
          method: "DELETE",
          credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        })
        if (!mountedRef.current) return
        if (res.ok) {
          setSessions((prev) => prev.filter((s) => s.id !== sessionId))
        } else {
          setActionError(`Révocation échouée (HTTP ${res.status})`)
        }
      } catch (err) {
        if (!mountedRef.current) return
        setActionError(err instanceof Error ? err.message : "Erreur réseau")
      } finally {
        setRevokingIds((prev) => {
          const next = new Set(prev)
          next.delete(sessionId)
          return next
        })
      }
    },
    [],
  )

  const executeRevokeOthers = useCallback(async () => {
    setActionError(null)
    setRevokeAllState("loading")
    try {
      const res = await fetch("/api/account/sessions", {
        method: "DELETE",
        credentials: "include",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      })
      if (!mountedRef.current) return
      if (res.ok) {
        setRevokeAllState("success")
        await fetchSessions()
        // Fix M8 round 1 — timer tracké pour cleanup au unmount.
        if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
        resetTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setRevokeAllState("idle")
        }, 3000)
      } else {
        setRevokeAllState("error")
        setActionError(`Révocation échouée (HTTP ${res.status})`)
      }
    } catch (err) {
      if (!mountedRef.current) return
      setRevokeAllState("error")
      setActionError(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [fetchSessions])

  // Fix H1 round 1 — handler triggered par confirmation Dialog (vs confirm() natif).
  const handleConfirmAccept = useCallback(() => {
    const current = pendingConfirm
    setPendingConfirm(null)
    if (current === "all") {
      void executeRevokeOthers()
    } else if (current) {
      void executeRevokeOne(current)
    }
  }, [pendingConfirm, executeRevokeOne, executeRevokeOthers])

  const otherSessionsCount = sessions.filter((s) => !s.isCurrent).length

  return (
    <DiabeoFormSection
      title="Sessions actives"
      description="Liste des appareils connectés à votre compte. Révoquez les sessions suspectes ou anciennes."
    >
      {state === "loading" && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Chargement des sessions…
        </p>
      )}

      {state === "error" && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm"
        >
          <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-medium text-destructive">Impossible de charger les sessions</p>
            {errorMessage && (
              <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>
            )}
            <DiabeoButton
              variant="diabeoTertiary"
              size="sm"
              onClick={() => void fetchSessions()}
              className="mt-2"
            >
              Réessayer
            </DiabeoButton>
          </div>
        </div>
      )}

      {state === "success" && sessions.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucune session active.</p>
      )}

      {state === "success" && sessions.length > 0 && (
        <>
          <ul className="space-y-2" aria-label="Sessions actives">
            {sessions.map((session) => {
              const DeviceIcon = getDeviceIcon(session.userAgent)
              const isRevoking = revokingIds.has(session.id)
              return (
                <li
                  key={session.id}
                  className={`flex items-start justify-between gap-3 rounded-md border p-3 ${
                    session.isCurrent ? "border-primary/30 bg-primary/5" : "border-border"
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <DeviceIcon className="size-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {summarizeUserAgent(session.userAgent)}
                        </span>
                        {session.isCurrent && (
                          <Badge variant="default" className="text-[10px]">
                            Cette session
                          </Badge>
                        )}
                        {session.mfaVerified && (
                          <Badge variant="secondary" className="text-[10px]">
                            <ShieldCheck className="size-3 mr-0.5" aria-hidden="true" />
                            <Acronym code="MFA" />
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {session.ipAddress ?? "IP inconnue"} · Dernière activité {formatRelativeTime(session.lastSeenAt, locale)}
                      </p>
                    </div>
                  </div>
                  {!session.isCurrent && (
                    <DiabeoButton
                      variant="diabeoTertiary"
                      size="sm"
                      onClick={() => setPendingConfirm(session.id)}
                      disabled={isRevoking}
                      aria-label={`Révoquer la session ${summarizeUserAgent(session.userAgent)}`}
                    >
                      <Trash2 className="size-3.5 mr-1" aria-hidden="true" />
                      {isRevoking ? "Révocation…" : "Révoquer"}
                    </DiabeoButton>
                  )}
                </li>
              )
            })}
          </ul>

          {otherSessionsCount > 0 && (
            <div className="flex items-center justify-between pt-3 mt-3 border-t">
              <p className="text-sm text-muted-foreground">
                {otherSessionsCount} {otherSessionsCount > 1 ? "autres sessions" : "autre session"}
              </p>
              <DiabeoButton
                variant="diabeoTertiary"
                size="sm"
                onClick={() => setPendingConfirm("all")}
                disabled={revokeAllState === "loading"}
              >
                {revokeAllState === "loading"
                  ? "Révocation…"
                  : revokeAllState === "success"
                  ? "✓ Révoquées"
                  : "Révoquer toutes les autres"}
              </DiabeoButton>
            </div>
          )}
        </>
      )}

      {/* Fix M8 round 1 — error feedback inline (vs anciennement silent fail). */}
      {actionError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm mt-3"
        >
          <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-destructive">{actionError}</p>
        </div>
      )}

      {/* Fix H1 + Fix A11y C1+C2 round 1 PR #457 — Dialog shadcn (Radix) gère
          focus trap + ESC handler + focus restoration + i18n. Remplace les
          `confirm()` natifs FR-hardcoded. */}
      <Dialog open={pendingConfirm !== null} onOpenChange={(open) => { if (!open) setPendingConfirm(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingConfirm === "all"
                ? "Révoquer toutes les autres sessions ?"
                : "Révoquer cette session ?"}
            </DialogTitle>
            <DialogDescription>
              {pendingConfirm === "all"
                ? "Tous vos autres appareils (téléphone, autre PC) seront déconnectés immédiatement."
                : "L'appareil sera déconnecté immédiatement."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DiabeoButton variant="diabeoTertiary" onClick={() => setPendingConfirm(null)}>
              Annuler
            </DiabeoButton>
            <DiabeoButton variant="diabeoDestructive" onClick={handleConfirmAccept}>
              Confirmer la révocation
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DiabeoFormSection>
  )
}
