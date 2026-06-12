/**
 * US-2047 — Page médecin de validation des propositions d'ajustement.
 *
 * Affiche la liste des `AdjustmentProposal` en statut `pending` avec :
 *  - boutons accepter / rejeter (par ligne, erreur scopée)
 *  - lien vers fiche patient
 *  - i18n FR / EN / AR (incluant RTL via dir="rtl" sur <html>)
 *
 * **RBAC** : DOCTOR (validation finale = engagement de prise en charge).
 * Le backend `adjustment.service` enforce déjà cette règle.
 *
 * **Accessibilité** :
 *  - liste sémantique avec `aria-label`
 *  - boutons avec `aria-label` contextuel patient
 *  - région `aria-live="polite"` pour annoncer accept/reject aux SR
 *  - `aria-busy` sur le bouton refresh + `role="status"` sur spinner
 *  - valeurs numériques wrappées en `<bdi>` pour le rendu RTL correct
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
import type { AdjustableParameter, ProposalStatus } from "@prisma/client"

/**
 * Aligné sur `model AdjustmentProposal` (prisma/schema.prisma:1030) :
 *  - `id` : UUID String (pas number — c'était un bug rendant le spinner inactif)
 *  - `parameterType` : enum Prisma `AdjustableParameter`
 *  - `currentValue` / `proposedValue` : Decimal sérialisé en string par Prisma JSON
 *
 * Les Decimal arrivent en string (sérialisation JSON Prisma) — on parse côté
 * affichage uniquement (pas de calcul ici).
 */
interface Proposal {
  id: string
  patientId: number
  parameterType: AdjustableParameter
  reason: string
  currentValue: string
  proposedValue: string
  status: ProposalStatus
  createdAt: string
  reviewedBy: number | null
  reviewedAt: string | null
}

export default function AdjustmentProposalsPage() {
  const fmt = useFormatters()
  const tCommon = useTranslations("common")
  const tAdj = useTranslations("adjustments")

  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [globalError, setGlobalError] = useState<string | null>(null)
  /** Erreur scopée par ligne — l'échec d'une accept/reject ne masque pas les autres. */
  const [rowErrors, setRowErrors] = useState<Map<string, string>>(new Map())
  const [actionPending, setActionPending] = useState<string | null>(null)
  /** Message d'annonce SR (live region) après accept/reject réussi. */
  const [liveAnnouncement, setLiveAnnouncement] = useState<string>("")

  const fetchProposals = useCallback(async () => {
    setLoading(true)
    setGlobalError(null)
    try {
      const res = await fetch("/api/adjustment-proposals?status=pending", {
        credentials: "include",
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Proposal[]
      setProposals(Array.isArray(data) ? data : [])
    } catch {
      setGlobalError(tCommon("error"))
    } finally {
      setLoading(false)
    }
  }, [tCommon])

  useEffect(() => {
    void fetchProposals()
  }, [fetchProposals])

  const review = async (proposal: Proposal, action: "accept" | "reject") => {
    setActionPending(proposal.id)
    setRowErrors((prev) => {
      const next = new Map(prev)
      next.delete(proposal.id)
      return next
    })
    try {
      // Backend routes export PATCH only (REST verb pour update partiel).
      // Accept attend `{ applyImmediately: boolean }` (default false) ; Reject
      // ignore le body. On envoie le strict minimum exigé par le schéma Zod.
      const res = await fetch(
        `/api/adjustment-proposals/${proposal.id}/${action}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "accept" ? { applyImmediately: false } : {},
          ),
        },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // SR announcement avant retrait visuel.
      setLiveAnnouncement(
        action === "accept"
          ? tAdj("acceptAria", { id: proposal.patientId })
          : tAdj("rejectAria", { id: proposal.patientId }),
      )
      setProposals((prev) => prev.filter((p) => p.id !== proposal.id))
    } catch {
      setRowErrors((prev) => {
        const next = new Map(prev)
        next.set(proposal.id, tAdj("rowError"))
        return next
      })
    } finally {
      setActionPending(null)
    }
  }

  return (
    <div className="space-y-6">
      <DashboardHeader title={tAdj("title")} />

      {/* Live region — annonce non-visuelle accept/reject aux lecteurs d'écran. */}
      <p
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        role="status"
      >
        {liveAnnouncement}
      </p>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">{tAdj("pendingTitle")}</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchProposals()}
            disabled={loading}
            aria-label={tAdj("refreshList")}
            aria-busy={loading}
          >
            <RefreshCw
              className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              aria-hidden="true"
            />
            <span className="ms-1">{tCommon("refresh")}</span>
          </Button>
        </CardHeader>
        <CardContent>
          {globalError && (
            <p
              role="alert"
              className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700"
            >
              {globalError}
            </p>
          )}

          {loading && proposals.length === 0 ? (
            <p
              role="status"
              aria-live="polite"
              className="py-8 text-center text-sm text-muted-foreground"
            >
              {tCommon("loading")}
            </p>
          ) : proposals.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {tCommon("noResults")}
            </p>
          ) : (
            <ul
              className="divide-y divide-border"
              aria-label={tAdj("listAria")}
            >
              {proposals.map((p) => {
                const rowError = rowErrors.get(p.id)
                const parameterLabel = tAdj(`parameter.${p.parameterType}`)
                return (
                  <li
                    key={p.id}
                    className="flex items-start justify-between gap-4 py-4"
                  >
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{parameterLabel}</Badge>
                        <Badge variant="outline" className="text-xs">
                          <Clock className="me-1 h-3 w-3" aria-hidden="true" />
                          {fmt.relativeTime(p.createdAt)}
                        </Badge>
                      </div>
                      <p className="text-sm text-foreground">
                        {/* `t.rich` permet d'injecter `<bdi>` autour du
                            patient ID — préserve la lecture LTR du nombre
                            même quand la phrase entière est rendue en RTL. */}
                        {tAdj.rich("patientReason", {
                          id: p.patientId,
                          reason: p.reason,
                          num: (chunks) => <bdi>{chunks}</bdi>,
                        })}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {/* `<bdi>` isole les nombres (latn) en contexte RTL : "1.27 → 1.45"
                            doit rester lu LTR même en arabe pour éviter toute
                            inversion clinique trompeuse. */}
                        <bdi>{fmt.number(Number(p.currentValue), { decimals: 2 })}</bdi>
                        {" → "}
                        <strong>
                          <bdi>
                            {fmt.number(Number(p.proposedValue), { decimals: 2 })}
                          </bdi>
                        </strong>
                      </p>
                      {rowError && (
                        <p
                          role="alert"
                          className="mt-1 text-xs text-red-700"
                        >
                          {rowError}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actionPending === p.id}
                        onClick={() => void review(p, "reject")}
                        aria-label={tAdj("rejectAria", { id: p.patientId })}
                      >
                        <XCircle
                          className="me-1 h-4 w-4"
                          aria-hidden="true"
                        />
                        {tAdj("reject")}
                      </Button>
                      <Button
                        size="sm"
                        disabled={actionPending === p.id}
                        onClick={() => void review(p, "accept")}
                        aria-label={tAdj("acceptAria", { id: p.patientId })}
                      >
                        <CheckCircle2
                          className="me-1 h-4 w-4"
                          aria-hidden="true"
                        />
                        {tAdj("accept")}
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
