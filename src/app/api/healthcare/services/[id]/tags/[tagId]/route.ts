/** US-2022 — Suppression d'un tag du cabinet (DOCTOR+ membre). */

import { NextResponse, type NextRequest } from "next/server"
import { requireRole, AuthError } from "@/lib/auth"
import { patientTagService } from "@/lib/services/patient-tag.service"
import { extractRequestContext } from "@/lib/services/audit.service"

type RouteParams = { params: Promise<{ id: string; tagId: string }> }

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const user = requireRole(req, "DOCTOR")
    const { tagId } = await params
    if (!/^\d+$/.test(tagId)) return NextResponse.json({ error: "invalidTagId" }, { status: 400 })

    const ctx = extractRequestContext(req)
    await patientTagService.delete(parseInt(tagId, 10), user.id, ctx)
    return NextResponse.json({ deleted: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    if (msg === "tagNotFound") {
      return NextResponse.json({ error: "tagNotFound" }, { status: 404 })
    }
    if (msg === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 })
    }
    console.error("[healthcare/services/:id/tags/:tagId DELETE]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
