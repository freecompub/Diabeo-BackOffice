import { NextResponse, type NextRequest } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { uploadFile, deleteFile, generateObjectKey } from "@/lib/storage/s3"
import { scanFile } from "@/lib/services/antivirus.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { prisma } from "@/lib/db/client"
import { writeFile, rm, mkdtemp } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const MAX_PHOTO_SIZE = 5 * 1024 * 1024

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const formData = await req.formData()
    const file = formData.get("photo")

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "photoRequired" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "invalidImageType", allowed: ["jpeg", "png", "webp"] }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    if (buffer.length > MAX_PHOTO_SIZE) {
      return NextResponse.json({ error: "fileTooLarge", maxBytes: MAX_PHOTO_SIZE }, { status: 400 })
    }

    const tmpDir = await mkdtemp(join(tmpdir(), "diabeo-photo-"))
    const tmpPath = join(tmpDir, file.name.replace(/[^a-zA-Z0-9._-]/g, "_"))

    try {
      await writeFile(tmpPath, buffer)
      const scan = await scanFile(tmpPath)
      if (!scan.clean) {
        return NextResponse.json({ error: "virusDetected" }, { status: 422 })
      }
    } finally {
      await rm(tmpDir, { recursive: true }).catch(() => {})
    }

    const key = generateObjectKey("avatars", file.name)
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

      return NextResponse.json({ photoUrl: key })
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
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account/photo PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
