import { NextResponse } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { auditService } from "@/lib/services/audit.service"

export async function PUT(req: Request) {
  try {
    const user = requireAuth(req)

    const formData = await req.formData()
    const file = formData.get("photo") as File | null

    if (!file) {
      return NextResponse.json({ error: "No photo provided" }, { status: 400 })
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"]
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Allowed: JPEG, PNG, WebP" },
        { status: 400 },
      )
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File too large. Maximum 5MB" },
        { status: 400 },
      )
    }

    // TODO: Upload to OVH Object Storage (S3-compatible)
    // For now, generate a placeholder URL
    const picUrl = `/storage/avatars/${user.id}-${Date.now()}.${file.type.split("/")[1]}`

    await prisma.user.update({
      where: { id: user.id },
      data: { pic: picUrl },
    })

    await auditService.log({
      userId: user.id,
      action: "UPDATE",
      resource: "USER",
      resourceId: String(user.id),
      metadata: { field: "pic", fileType: file.type, fileSize: file.size },
    })

    return NextResponse.json({ pic: picUrl })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[account/photo PUT]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
