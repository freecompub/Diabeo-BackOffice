/**
 * US-2605 — Ouverture / reprise d'une séance de revue de consultation.
 *
 * `POST /api/encounters` { patientId } → ouvre (ou reprend) le brouillon du jour
 * pour (patient, PS). Réservé NURSE+ (un VIEWER n'a pas accès au mode revue) ;
 * l'accès au patient est vérifié en service (`canAccessPatient`).
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

const bodySchema = z.object({ patientId: z.number().int().positive() })

export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")

    const body = await req.json().catch(() => null)
    const parsed = bodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const ctx = extractRequestContext(req)
    const encounter = await encounterService.openOrResume(
      parsed.data.patientId, user.id, user.role, ctx,
    )
    return NextResponse.json(encounter)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof EncounterError) {
      return NextResponse.json({ error: error.code }, { status: encounterErrorStatus(error.code) })
    }
    console.error("[encounters]", error instanceof Error ? error.message : error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
