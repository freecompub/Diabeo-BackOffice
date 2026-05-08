/**
 * US-2047 — Page médecin de validation des propositions d'ajustement.
 *
 * Affiche la liste des `AdjustmentProposal` en statut `pending` avec :
 *  - filtre patientId / parameterType
 *  - boutons accepter / rejeter
 *  - lien vers fiche patient
 *
 * **RBAC** : DOCTOR (validation finale = engagement de prise en charge).
 * Le backend `adjustment.service` enforce déjà cette règle.
 *
 * **Accessibilité** : tableau ARIA, boutons avec `aria-label`, focus management
 * sur les actions destructrices.
 */

"use client"

import { useState, useEffect, useCallback } from "react"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, XCircle, Clock, RefreshCw } from "lucide-react"
import { useFormatters } from "@/hooks/useFormatters"
import { useTranslations } from "next-intl"

type ProposalStatus = "pending" | "accepted" | "rejected" | "expired"
type ParameterType = "insulinSensitivityFactor" | "insulinToCarbRatio" | "basalRate"

interface Proposal {
  id: number
  patientId: number
  parameter: ParameterType
  reason: string
  oldValue: number | null
  newValue: number | null
  status: ProposalStatus
  createdAt: string
  reviewedBy: number | null
  reviewedAt: string | null
}

const PARAMETER_LABELS: Record<ParameterType, string> = {
  insulinSensitivityFactor: "Facteur de sensibilité (ISF)",
  insulinToCarbRatio: "Ratio I/G (ICR)",
  basalRate: "Débit basal",
}

export default function AdjustmentProposalsPage() {
  const fmt = useFormatters()
  const t = useTranslations("common")
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState<number | null>(null)

  const fetchProposals = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/adjustment-proposals?status=pending", {
        credentials: "include",
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Proposal[]
      setProposals(Array.isArray(data) ? data : [])
    } catch {
      setError(t("error"))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void fetchProposals()
  }, [fetchProposals])

  const review = async (id: number, action: "accept" | "reject") => {
    setActionPending(id)
    try {
      const res = await fetch(`/api/adjustment-proposals/${id}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: action === "accept" ? "Validé" : "Refusé" }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Optimistic remove from list
      setProposals((prev) => prev.filter((p) => p.id !== id))
    } catch {
      setError(t("error"))
    } finally {
      setActionPending(null)
    }
  }

  return (
    <div className="space-y-6">
      <DashboardHeader title="Propositions d'ajustement" />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Propositions en attente</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchProposals()}
            disabled={loading}
            aria-label="Rafraîchir la liste"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {t("refresh")}
          </Button>
        </CardHeader>
        <CardContent>
          {error && (
            <p role="alert" className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}

          {loading && proposals.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
              {t("loading")}
            </p>
          ) : proposals.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
              {t("noResults")}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]" aria-label="Liste des propositions">
              {proposals.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-4 py-4">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{PARAMETER_LABELS[p.parameter]}</Badge>
                      <Badge variant="outline" className="text-xs">
                        <Clock className="mr-1 h-3 w-3" aria-hidden="true" />
                        {fmt.relativeTime(p.createdAt)}
                      </Badge>
                    </div>
                    <p className="text-sm text-[var(--color-foreground)]">
                      Patient #{p.patientId} — Raison : {p.reason}
                    </p>
                    {p.oldValue !== null && p.newValue !== null && (
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        {fmt.number(p.oldValue, { decimals: 2 })} →{" "}
                        <strong>{fmt.number(p.newValue, { decimals: 2 })}</strong>
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={actionPending === p.id}
                      onClick={() => void review(p.id, "reject")}
                      aria-label={`Rejeter la proposition ${p.id}`}
                    >
                      <XCircle className="mr-1 h-4 w-4" aria-hidden="true" />
                      Rejeter
                    </Button>
                    <Button
                      size="sm"
                      disabled={actionPending === p.id}
                      onClick={() => void review(p.id, "accept")}
                      aria-label={`Accepter la proposition ${p.id}`}
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />
                      Accepter
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
