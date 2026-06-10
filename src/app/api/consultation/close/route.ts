/**
 * US-2018b — POST /api/consultation/close
 *
 * Invalide un jeton de consultation (idempotent). Appelé au clic « Fermer »
 * ET via `navigator.sendBeacon` au déchargement de la page (`pagehide`). Le
 * beacon peut envoyer le corps en `text/plain` : on parse les deux formes.
 */

import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError, requireAuth } from "@/lib/auth"
import { closeConsultation } from "@/lib/services/consultation.service"

const bodySchema = z.object({ cTok: z.string().uuid() })

async function readBody(req: NextRequest): Promise<unknown> {
  const raw = await req.text().catch(() => "")
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const parsed = bodySchema.safeParse(await readBody(req))
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed" }, { status: 400 })
    }
    await closeConsultation(parsed.data.cTok, user.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
