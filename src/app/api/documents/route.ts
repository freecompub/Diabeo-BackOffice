import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { DocumentCategory } from "@prisma/client"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { documentService } from "@/lib/services/document.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const createDocSchema = z.object({
  patientId: z.number().int().positive().optional(),
  title: z.string().min(1).max(255),
  category: z.nativeEnum(DocumentCategory).optional(),
  patientShare: z.boolean().optional(),
  mimeType: z.string().min(1),
  fileSize: z.number().int().positive().max(50 * 1024 * 1024),
  memberId: z.number().int().positive().optional(),
})

/** GET /api/documents — list accessible documents */
export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const patientIdParam = req.nextUrl.searchParams.get("patientId")
    const patientId = await resolvePatientId(user.id, user.role, patientIdParam ? parseInt(patientIdParam, 10) : undefined)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const ctx = extractRequestContext(req)
    const docs = await documentService.list(patientId, user.role, user.id, ctx)
    return NextResponse.json(docs)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[documents GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

/** POST /api/documents — create document entry */
export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const body = await req.json()
    const parsed = createDocSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const { patientId: pidParam, ...docInput } = parsed.data
    const patientId = await resolvePatientId(user.id, user.role, pidParam)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const ctx = extractRequestContext(req)
    const doc = await documentService.create(patientId, docInput, user.id, ctx)
    return NextResponse.json(doc, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "invalidMimeType") {
      return NextResponse.json({ error: "invalidMimeType" }, { status: 400 })
    }
    if (error instanceof Error && error.message === "fileTooLarge") {
      return NextResponse.json({ error: "fileTooLarge" }, { status: 400 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[documents POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
