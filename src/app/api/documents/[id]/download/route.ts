import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { documentService } from "@/lib/services/document.service"
import { extractRequestContext } from "@/lib/services/audit.service"

type Params = { params: Promise<{ id: string }> }

/** GET /api/documents/:id/download — stream file from S3 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent)
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const { id } = await params
    const docId = parseInt(id, 10)
    if (isNaN(docId))
      return NextResponse.json({ error: "invalidId" }, { status: 400 })

    const patientIdParam = req.nextUrl.searchParams.get("patientId")
    const patientId = await resolvePatientId(
      user.id,
      user.role,
      patientIdParam ? parseInt(patientIdParam, 10) : undefined,
    )
    if (!patientId)
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const ctx = extractRequestContext(req)
    const { body, contentType } = await documentService.download(docId, patientId, user.id, ctx)

    return new NextResponse(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    if (error instanceof AuthError)
      return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "documentNotFound")
      return NextResponse.json({ error: "documentNotFound" }, { status: 404 })
    if (error instanceof Error && error.message === "noFileAttached")
      return NextResponse.json({ error: "noFileAttached" }, { status: 404 })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[documents/download GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
