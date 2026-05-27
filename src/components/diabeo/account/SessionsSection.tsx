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
 */

import { useCallback, useEffect, useState } from "react"
import { Monitor, Smartphone, Tablet, Trash2, ShieldCheck, AlertCircle } from "lucide-react"
import { DiabeoButton } from "@/components/diabeo/DiabeoButton"
import { DiabeoFormSection } from "@/components/diabeo/DiabeoFormSection"
import { Badge } from "@/components/ui/badge"

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

/**
 * Format date relatif simple. Pas d'i18n iter 1 — itération suivante via
 * `formatRelativeTime` de @/lib/intl/formatters si besoin.
 */
function formatRelative(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours}h`
  const days = Math.floor(hours / 24)
  return `il y a ${days}j`
}

export function SessionsSection() {
  const [sessions, setSessions] = useState<SessionDTO[]>([])
  const [state, setState] = useState<AsyncState>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [revokeAllState, setRevokeAllState] = useState<AsyncState>("idle")
  const [revokingIds, setRevokingIds] = useState<Set<string>>(new Set())

  const fetchSessions = useCallback(async () => {
    setState("loading")
    setErrorMessage(null)
    try {
      const res = await fetch("/api/account/sessions", { credentials: "include" })
      if (!res.ok) {
        setState("error")
        setErrorMessage(`HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { items?: SessionDTO[] }
      setSessions(data.items ?? [])
      setState("success")
    } catch (err) {
      setState("error")
      setErrorMessage(err instanceof Error ? err.message : "Erreur réseau")
    }
  }, [])

  useEffect(() => {
    void fetchSessions()
  }, [fetchSessions])

  const handleRevokeOne = useCallback(
    async (sessionId: string) => {
      if (!confirm("Révoquer cette session ? L'appareil sera déconnecté immédiatement.")) {
        return
      }
      setRevokingIds((prev) => new Set(prev).add(sessionId))
      try {
        const res = await fetch(`/api/account/sessions/${sessionId}`, {
          method: "DELETE",
          credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest" },
        })
        if (res.ok) {
          // Optimistic remove + refetch pour state cohérent.
          setSessions((prev) => prev.filter((s) => s.id !== sessionId))
        }
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

  const handleRevokeOthers = useCallback(async () => {
    if (
      !confirm(
        "Révoquer toutes les autres sessions ? Tous vos autres appareils (téléphone, autre PC) seront déconnectés.",
      )
    ) {
      return
    }
    setRevokeAllState("loading")
    try {
      const res = await fetch("/api/account/sessions", {
        method: "DELETE",
        credentials: "include",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      })
      if (res.ok) {
        setRevokeAllState("success")
        await fetchSessions()
        // Reset state success après 3s pour permettre nouvelle action.
        setTimeout(() => setRevokeAllState("idle"), 3000)
      } else {
        setRevokeAllState("error")
      }
    } catch {
      setRevokeAllState("error")
    }
  }, [fetchSessions])

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
                            MFA
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {session.ipAddress ?? "IP inconnue"} · Dernière activité {formatRelative(session.lastSeenAt)}
                      </p>
                    </div>
                  </div>
                  {!session.isCurrent && (
                    <DiabeoButton
                      variant="diabeoTertiary"
                      size="sm"
                      onClick={() => void handleRevokeOne(session.id)}
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
                onClick={() => void handleRevokeOthers()}
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
    </DiabeoFormSection>
  )
}
