"use client"

/**
 * MyDiabby Import Page — US-WEB-210
 *
 * DOCTOR-only, staging-only feature that allows connecting a MyDiabby account
 * and synchronising patient data into the Diabeo backoffice.
 *
 * State machine:
 *   loading    → fetches accounts list on mount
 *   noAccounts → shows connect form (no credentials stored)
 *   hasAccounts → shows account list with sync / disconnect actions
 *   stagingOnly → API returned 403 stagingOnly → shows unavailable empty state
 *
 * Security:
 * - All fetch calls include credentials: "include" and X-Requested-With header
 * - No patient PII is stored in component state beyond masked email display
 *
 * Clinical note:
 * - Import only happens on explicit user action (sync button)
 * - No automatic background sync is triggered from this UI
 */

import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Download } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  DiabeoButton,
  DiabeoTextField,
  DiabeoCard,
  DiabeoEmptyState,
  AlertBanner,
} from "@/components/diabeo"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MyDiabbyAccount {
  id: string
  email: string
  lastSyncAt: string | null
  createdAt: string
}

interface SyncResult {
  credentialId: string
  count: number | null
  error: string | null
}

type PageState = "loading" | "noAccounts" | "hasAccounts" | "stagingOnly"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Masks an email address: first char + *** + @domain
 * e.g. "doctor@hospital.fr" → "d***@hospital.fr"
 */
function maskEmail(email: string): string {
  const atIndex = email.indexOf("@")
  if (atIndex <= 0) return "***"
  const firstChar = email[0]
  const domain = email.slice(atIndex)
  return `${firstChar}***${domain}`
}

/**
 * Formats a date as a relative human-readable string or absolute date.
 * Uses the browser locale for formatting.
 */
function formatSyncDate(dateStr: string | null, neverLabel: string): string {
  if (!dateStr) return neverLabel
  const date = new Date(dateStr)
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)

  if (diffMin < 1) return "< 1 min"
  if (diffMin < 60) return `${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h`
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

// ---------------------------------------------------------------------------
// Shared fetch wrapper
// ---------------------------------------------------------------------------

const API_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "XMLHttpRequest",
} as const

async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<{ data: T | null; status: number; ok: boolean }> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { ...API_HEADERS, ...(options?.headers ?? {}) },
    ...options,
  })
  const data = res.ok ? ((await res.json()) as T) : null
  return { data, status: res.status, ok: res.ok }
}

// ---------------------------------------------------------------------------
// ConnectForm sub-component
// ---------------------------------------------------------------------------

interface ConnectFormProps {
  onSuccess: () => void
}

/**
 * ConnectForm — credential input for linking a MyDiabby account.
 *
 * Handles its own loading / error state.
 * On success, notifies parent to refresh the account list.
 */
function ConnectForm({ onSuccess }: ConnectFormProps) {
  const t = useTranslations("mydiabby")

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError(null)
      setLoading(true)

      try {
        const { data, status, ok } = await apiFetch<{
          success: boolean
          result: unknown
        }>("/api/import/mydiabby/connect", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        })

        if (!ok) {
          if (status === 403) {
            setError(t("gdprRequired"))
          } else {
            setError(t("connectError"))
          }
          return
        }

        if (data?.success) {
          onSuccess()
        } else {
          setError(t("connectError"))
        }
      } catch {
        setError(t("connectError"))
      } finally {
        setLoading(false)
      }
    },
    [email, password, onSuccess, t]
  )

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="connect-form"
      aria-label={t("connectTitle")}
      className="flex flex-col gap-4"
      noValidate
    >
      <h2 className="text-base font-semibold text-foreground">
        {t("connectTitle")}
      </h2>

      {error !== null && (
        <AlertBanner severity="warning" title={error} />
      )}

      <DiabeoTextField
        label={t("email")}
        type="email"
        placeholder={t("emailPlaceholder")}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
        data-testid="connect-email"
      />

      <DiabeoTextField
        label={t("password")}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        autoComplete="current-password"
        data-testid="connect-password"
      />

      <DiabeoButton
        type="submit"
        variant="diabeoPrimary"
        loading={loading}
        fullWidth
        data-testid="connect-button"
      >
        {loading ? t("connecting") : t("connectButton")}
      </DiabeoButton>
    </form>
  )
}

// ---------------------------------------------------------------------------
// AccountCard sub-component
// ---------------------------------------------------------------------------

interface AccountCardProps {
  account: MyDiabbyAccount
  onDisconnect: (credentialId: string) => void
}

/**
 * AccountCard — displays a connected MyDiabby account with sync and
 * disconnect actions.
 *
 * Sync feedback is shown inline below the card actions.
 * Disconnect requires confirmation via a Dialog before sending the API call.
 */
function AccountCard({ account, onDisconnect }: AccountCardProps) {
  const t = useTranslations("mydiabby")
  const tCommon = useTranslations("common")

  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const maskedEmail = maskEmail(account.email)
  const neverLabel = t("never")

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setSyncResult(null)

    try {
      const { data, ok } = await apiFetch<{
        success: boolean
        result: { count?: number }
      }>("/api/import/mydiabby/sync", {
        method: "POST",
        body: JSON.stringify({ credentialId: account.id }),
      })

      if (ok && data?.success) {
        setSyncResult({
          credentialId: account.id,
          count: data.result?.count ?? null,
          error: null,
        })
      } else {
        setSyncResult({
          credentialId: account.id,
          count: null,
          error: t("syncError"),
        })
      }
    } catch {
      setSyncResult({
        credentialId: account.id,
        count: null,
        error: t("syncError"),
      })
    } finally {
      setSyncing(false)
    }
  }, [account.id, t])

  const handleDisconnectConfirm = useCallback(async () => {
    setDisconnecting(true)

    try {
      const { ok } = await apiFetch<{ success: boolean }>(
        "/api/import/mydiabby/disconnect",
        {
          method: "DELETE",
          body: JSON.stringify({ credentialId: account.id }),
        }
      )

      setDisconnectOpen(false)
      if (ok) {
        onDisconnect(account.id)
      }
    } catch {
      setDisconnectOpen(false)
    } finally {
      setDisconnecting(false)
    }
  }, [account.id, onDisconnect])

  return (
    <>
      <DiabeoCard variant="outlined" padding="md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Account info */}
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-foreground">
                {maskedEmail}
              </span>

              {/* Status badge */}
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5",
                  "text-xs font-medium",
                  "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20"
                )}
              >
                <span
                  className="me-1 h-1.5 w-1.5 rounded-full bg-emerald-500"
                  aria-hidden="true"
                />
                {t("connected")}
              </span>
            </div>

            <p className="text-xs text-muted-foreground">
              {t("lastSync")}:{" "}
              <time
                dateTime={account.lastSyncAt ?? undefined}
                className="font-medium"
              >
                {formatSyncDate(account.lastSyncAt, neverLabel)}
              </time>
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <DiabeoButton
              variant="diabeoTertiary"
              size="sm"
              loading={syncing}
              disabled={syncing}
              onClick={handleSync}
              aria-label={`${t("syncButton")} — ${maskedEmail}`}
              data-testid="sync-button"
            >
              {syncing ? t("syncing") : t("syncButton")}
            </DiabeoButton>

            <DiabeoButton
              variant="diabeoDestructive"
              size="sm"
              onClick={() => setDisconnectOpen(true)}
              aria-label={`${t("disconnectButton")} — ${maskedEmail}`}
              data-testid="disconnect-button"
            >
              {t("disconnectButton")}
            </DiabeoButton>
          </div>
        </div>

        {/* Sync feedback */}
        {syncResult !== null && (
          <div className="mt-3">
            {syncResult.error !== null ? (
              <AlertBanner severity="warning" title={syncResult.error} />
            ) : (
              <AlertBanner
                severity="info"
                title={
                  syncResult.count !== null
                    ? t("syncSuccess", { count: syncResult.count })
                    : t("syncButton")
                }
              />
            )}
          </div>
        )}
      </DiabeoCard>

      {/* Disconnect confirmation dialog — @base-ui/react, no asChild */}
      <Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("disconnectTitle")}</DialogTitle>
            <DialogDescription>{t("disconnectConfirm")}</DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <DialogClose
              render={
                <DiabeoButton variant="diabeoGhost" disabled={disconnecting} />
              }
            >
              {tCommon("cancel")}
            </DialogClose>

            <DiabeoButton
              variant="diabeoDestructive"
              loading={disconnecting}
              onClick={handleDisconnectConfirm}
            >
              {disconnecting ? t("disconnecting") : t("disconnectButton")}
            </DiabeoButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * MyDiabbyPage — Entry point for the MyDiabby import feature (US-WEB-210).
 *
 * Staging-only: if the accounts API returns 403, the page shows an
 * unavailable empty state instead of the connect / account list UI.
 *
 * Accessibility:
 * - Loading state announced via aria-busy + aria-label
 * - Staging notice rendered as role="status" AlertBanner (polite live region)
 * - Disconnect dialog labelled with DialogTitle + DialogDescription
 */
export default function MyDiabbyPage() {
  const t = useTranslations("mydiabby")
  const tCommon = useTranslations("common")

  const [pageState, setPageState] = useState<PageState>("loading")
  const [accounts, setAccounts] = useState<MyDiabbyAccount[]>([])

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const fetchAccounts = useCallback(async () => {
    setPageState("loading")

    try {
      const { data, status, ok } = await apiFetch<{
        accounts: MyDiabbyAccount[]
      }>("/api/import/mydiabby/accounts")

      if (!ok) {
        if (status === 403) {
          setPageState("stagingOnly")
        } else {
          setAccounts([])
          setPageState("noAccounts")
        }
        return
      }

      const list = data?.accounts ?? []
      setAccounts(list)
      setPageState(list.length > 0 ? "hasAccounts" : "noAccounts")
    } catch {
      setAccounts([])
      setPageState("noAccounts")
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setPageState("loading")
      try {
        const { data, status, ok } = await apiFetch<{
          accounts: MyDiabbyAccount[]
        }>("/api/import/mydiabby/accounts")

        if (cancelled) return

        if (!ok) {
          setPageState(status === 403 ? "stagingOnly" : "noAccounts")
          if (status !== 403) setAccounts([])
          return
        }

        const list = data?.accounts ?? []
        setAccounts(list)
        setPageState(list.length > 0 ? "hasAccounts" : "noAccounts")
      } catch {
        if (!cancelled) {
          setAccounts([])
          setPageState("noAccounts")
        }
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  // -------------------------------------------------------------------------
  // Callbacks
  // -------------------------------------------------------------------------

  const handleConnectSuccess = useCallback(() => {
    void fetchAccounts()
  }, [fetchAccounts])

  const handleDisconnect = useCallback((credentialId: string) => {
    setAccounts((prev) => {
      const next = prev.filter((a) => a.id !== credentialId)
      setPageState(next.length > 0 ? "hasAccounts" : "noAccounts")
      return next
    })
  }, [])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div data-testid="mydiabby-page" className="flex flex-col gap-6">
      {/* Page heading */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* ── Loading state ───────────────────────────────────────────────── */}
      {pageState === "loading" && (
        <div
          role="status"
          aria-label={tCommon("loading")}
          aria-busy="true"
          className="flex items-center justify-center py-16"
        >
          <Loader2
            className="h-8 w-8 animate-spin text-teal-600"
            aria-hidden="true"
          />
        </div>
      )}

      {/* ── Staging-only guard ──────────────────────────────────────────── */}
      {pageState === "stagingOnly" && (
        <DiabeoEmptyState
          variant="noData"
          title={t("notAvailable")}
          message={t("notAvailableMessage")}
          icon={<Download className="h-12 w-12" aria-hidden="true" />}
        />
      )}

      {/* ── No accounts: show connect form ──────────────────────────────── */}
      {pageState === "noAccounts" && (
        <>
          <AlertBanner severity="info" title={t("stagingNotice")} />

          <div className="max-w-2xl mx-auto w-full">
            <DiabeoCard variant="elevated" padding="lg">
              <ConnectForm onSuccess={handleConnectSuccess} />
            </DiabeoCard>
          </div>
        </>
      )}

      {/* ── Has accounts: show account list ─────────────────────────────── */}
      {pageState === "hasAccounts" && (
        <>
          <AlertBanner severity="info" title={t("stagingNotice")} />

          <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
            <h2 className="text-base font-semibold text-foreground">
              {t("accountsTitle")}
            </h2>

            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onDisconnect={handleDisconnect}
              />
            ))}

            {/* Allow linking an additional account */}
            <DiabeoCard variant="filled" padding="lg">
              <ConnectForm onSuccess={handleConnectSuccess} />
            </DiabeoCard>
          </div>
        </>
      )}
    </div>
  )
}
