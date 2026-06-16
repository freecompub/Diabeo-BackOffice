/**
 * US-2605 — Sauvegarde du brouillon de compte rendu d'une séance de revue.
 *
 * `PATCH /api/encounters/:id/draft` { content } → chiffre + persiste le brouillon.
 * Réservé NURSE+ ; propriétaire-only + statut draft vérifiés en service.
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

// Borne de taille défensive (le compte rendu reste un texte clinique, pas un blob).
const bodySchema = z.object({ content: z.string().max(20000) })

export async function PATCH(
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
    await encounterService.saveDraft(encounterId, user.id, parsed.data.content, ctx)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof EncounterError) {
      return NextResponse.json({ error: error.code }, { status: encounterErrorStatus(error.code) })
    }
    console.error("[encounters/draft]", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
