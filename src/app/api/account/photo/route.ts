import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { requireGdprConsent } from "@/lib/gdpr"
import { uploadFile, deleteFile, generateObjectKey } from "@/lib/storage/s3"
import { scanBuffer } from "@/lib/services/antivirus.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { checkApiRateLimit } from "@/lib/auth/api-rate-limit"
import { prisma } from "@/lib/db/client"
import { logger } from "@/lib/logger"

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const MAX_PHOTO_SIZE = 5 * 1024 * 1024

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent)
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const rl = await checkApiRateLimit(`photo:${user.id}`, {
      bucket: "photo-upload", windowSec: 3600, max: 10,
    })
    if (!rl.allowed)
      return NextResponse.json({ error: "rateLimited", retryAfter: rl.retryAfterSec }, { status: 429 })

    const formData = await req.formData()
    const file = formData.get("photo")

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "photoRequired" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "invalidImageType", allowed: ["jpeg", "png", "webp"] }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length === 0) {
      return NextResponse.json({ error: "emptyFile" }, { status: 400 })
    }
    if (buffer.length > MAX_PHOTO_SIZE) {
      return NextResponse.json({ error: "fileTooLarge", maxBytes: MAX_PHOTO_SIZE }, { status: 400 })
    }

    const scan = await scanBuffer(buffer, file.name)
    if (!scan.clean) {
      return NextResponse.json({ error: "virusDetected" }, { status: 422 })
    }

    const key = generateObjectKey("avatars", file.type)
    await uploadFile(key, buffer, file.type)

    try {
      const currentUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { photoUrl: true },
      })

      await prisma.user.update({
        where: { id: user.id },
        data: { photoUrl: key },
      })

      if (currentUser?.photoUrl) {
        await deleteFile(currentUser.photoUrl).catch(() => {})
      }

      const ctx = extractRequestContext(req)
      await auditService.log({
        userId: user.id,
        action: "UPDATE",
        resource: "USER",
        resourceId: String(user.id),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { field: "photo", mimeType: file.type, size: buffer.length },
      })

      return NextResponse.json({ updated: true })
    } catch (dbError) {
      await deleteFile(key).catch(() => {})
      throw dbError
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof Error && error.message.startsWith("OVH S3 not configured")) {
      return NextResponse.json({ error: "storageNotConfigured" }, { status: 503 })
    }
    logger.error("account/photo", "Photo upload failed", {}, error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
