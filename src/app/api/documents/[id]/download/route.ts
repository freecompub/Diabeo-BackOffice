import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { prisma } from "@/lib/db/client"
import { documentService } from "@/lib/services/document.service"
import { extractRequestContext } from "@/lib/services/audit.service"
import { logger } from "@/lib/logger"

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
    if (isNaN(docId) || docId <= 0)
      return NextResponse.json({ error: "invalidId" }, { status: 400 })

    const patientIdParam = req.nextUrl.searchParams.get("patientId")
    const parsedPid = patientIdParam ? parseInt(patientIdParam, 10) : undefined
    if (patientIdParam && (isNaN(parsedPid!) || parsedPid! <= 0))
      return NextResponse.json({ error: "invalidPatientId" }, { status: 400 })

    const patientId = await resolvePatientId(user.id, user.role, parsedPid)
    if (!patientId)
      return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    // Garde consentement `shareWithProviders` pour les rôles PRO (cohérence avec
    // la liste/le dossier patient : un patient ayant retiré le partage ne doit
    // pas voir ses documents servis à un soignant). Le patient lui-même (VIEWER)
    // accède à ses propres documents — gouverné par `patientShare` côté service.
    // Refus → 404 uniforme (anti-énumération, indistinct de "pas d'accès").
    if (user.role !== "VIEWER") {
      const subject = await prisma.patient.findFirst({
        where: { id: patientId, deletedAt: null },
        select: { userId: true },
      })
      if (!subject)
        return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
      const privacy = await prisma.userPrivacySettings.findUnique({
        where: { userId: subject.userId },
        select: { shareWithProviders: true },
      })
      if (privacy && !privacy.shareWithProviders)
        return NextResponse.json({ error: "patientNotFound" }, { status: 404 })
    }

    const ctx = extractRequestContext(req)
    const { body, contentType, contentLength, fileName } = await documentService.download(
      docId, patientId, user.role, user.id, ctx,
    )

    const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_")
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "X-Frame-Options": "DENY",
    }
    if (contentLength != null) {
      headers["Content-Length"] = String(contentLength)
    }

    return new NextResponse(body, { headers })
  } catch (error) {
    if (error instanceof AuthError)
      return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "documentNotFound")
      return NextResponse.json({ error: "documentNotFound" }, { status: 404 })
    if (error instanceof Error && error.message === "noFileAttached")
      return NextResponse.json({ error: "noFileAttached" }, { status: 404 })
    logger.error("documents/download", "Download failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
