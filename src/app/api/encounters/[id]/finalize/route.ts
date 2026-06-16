/**
 * US-2605 — Finalisation du compte rendu de revue (addendum IMMUABLE).
 *
 * `POST /api/encounters/:id/finalize` { content } → émet un
 * `ConsultationReportAddendum` append-only, clôt la séance, vide le brouillon.
 * Réservé NURSE+ ; propriétaire-only + statut draft vérifiés en service.
 *
 * **Ancrage serveur-autoritaire** : `period`/`dataAsOf` sont fixés ICI (constante
 * `REVIEW_PERIOD` + instant serveur), jamais fournis par le client — le compte
 * rendu ne peut pas mentir sur la version des données utilisée.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRole, AuthError } from "@/lib/auth"
import {
  encounterService,
  EncounterError,
  encounterErrorStatus,
} from "@/lib/services/encounter.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { REVIEW_PERIOD } from "@/lib/review-constants"

const bodySchema = z.object({ content: z.string().min(1).max(20000) })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = requireRole(req, "NURSE")

    const { id } = await params
    const encounterId = Number(id)
    if (!Number.isInteger(encounterId) || encounterId <= 0) {
      return NextResponse.json({ error: "invalidId" }, { status: 400 })
    }

    const body = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    const result = await encounterService.finalizeReport(
      encounterId, user.id, parsed.data.content,
      // Ancrage serveur-autoritaire (anti-falsification de la version des données).
      { period: REVIEW_PERIOD, dataAsOf: new Date() },
      ctx,
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof EncounterError) {
      return NextResponse.json({ error: error.code }, { status: encounterErrorStatus(error.code) })
    }
    console.error("[encounters/finalize]", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
