/**
 * US-2018b — POST /api/consultation/open
 *
 * Ouvre une consultation patient éphémère pour un professionnel. Le client
 * envoie le `publicRef` (UUID opaque) du patient choisi dans la liste ; le
 * serveur vérifie l'accès (RBAC portefeuille) et renvoie un jeton `cTok` à
 * usage en-tête pour les lectures de données. Aucun id patient n'est exposé.
 *
 * VIEWER (le patient) n'utilise jamais cette route : il accède à son propre
 * dossier sans jeton (cf. `resolvePatientForRequest`).
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { openConsultation } from "@/lib/services/consultation.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const bodySchema = z.object({ patientRef: z.string().uuid() })

export async function POST(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireAuth(req)
    if (user.role === "VIEWER") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }

    const result = await openConsultation(user.id, user.role, parsed.data.patientRef, ctx)
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 404 })
    }
    return NextResponse.json({ cTok: result.cTok })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
