import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { DocumentCategory } from "@prisma/client"
import { requireRole, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { documentService } from "@/lib/services/document.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { checkApiRateLimit } from "@/lib/auth/api-rate-limit"
import { logger } from "@/lib/logger"

const MAX_FILE_SIZE = 50 * 1024 * 1024

const metaSchema = z.object({
  title: z.string().min(1).max(255),
  category: z.nativeEnum(DocumentCategory).optional(),
  patientShare: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  patientId: z
    .string()
    .transform((v) => parseInt(v, 10))
    .pipe(z.number().int().positive())
    .optional(),
})

/** POST /api/documents/upload — multipart file upload with antivirus scan */
export async function POST(req: NextRequest) {
  try {
    const user = requireRole(req, "NURSE")
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent)
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const rl = await checkApiRateLimit(`doc-upload:${user.id}`, {
      bucket: "doc-upload", windowSec: 3600, max: 20,
    })
    if (!rl.allowed)
      return NextResponse.json({ error: "rateLimited", retryAfter: rl.retryAfterSec }, { status: 429 })

    const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10)
    if (contentLength > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "fileTooLarge" }, { status: 413 })
    }

    const formData = await req.formData()
    const file = formData.get("file")

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "fileRequired" }, { status: 400 })
    }

    const meta = metaSchema.safeParse({
      title: formData.get("title") ?? file.name,
      category: formData.get("category") ?? undefined,
      patientShare: formData.get("patientShare") ?? undefined,
      patientId: formData.get("patientId") ?? undefined,
    })

    if (!meta.success) {
      return NextResponse.json(
        { error: "validationFailed", details: meta.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const patientId = await resolvePatientId(
      user.id,
      user.role,
      meta.data.patientId,
    )
    if (!patientId)
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const ctx = extractRequestContext(req)

    const doc = await documentService.upload(
      patientId,
      {
        buffer,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
      },
      {
        title: meta.data.title,
        category: meta.data.category,
        patientShare: meta.data.patientShare,
      },
      user.id,
      ctx,
    )

    return NextResponse.json(doc, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError)
      return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error) {
      if (error.message === "invalidMimeType")
        return NextResponse.json({ error: "invalidMimeType" }, { status: 400 })
      if (error.message === "emptyFile")
        return NextResponse.json({ error: "emptyFile" }, { status: 400 })
      if (error.message === "fileTooLarge")
        return NextResponse.json({ error: "fileTooLarge" }, { status: 400 })
      if (error.message === "virusDetected")
        return NextResponse.json({ error: "virusDetected" }, { status: 422 })
      if (error.message.startsWith("OVH S3 not configured"))
        return NextResponse.json({ error: "storageNotConfigured" }, { status: 503 })
    }
    logger.error("documents/upload", "Upload failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
