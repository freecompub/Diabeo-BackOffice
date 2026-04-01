import { NextResponse } from "next/server"
import { requireAuth, AuthError } from "@/lib/auth"
import { generateUserExport } from "@/lib/services/export.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"

export async function GET(req: Request) {
  try {
    const user = requireAuth(req)
    const ctx = extractRequestContext(req)

    const exportData = await generateUserExport(user.id)

    if (!exportData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const json = JSON.stringify(exportData, null, 2)
    const sizeBytes = Buffer.byteLength(json, "utf8")

    await auditService.log({
      userId: user.id,
      action: "EXPORT",
      resource: "USER",
      resourceId: String(user.id),
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { format: "json", sizeBytes },
    })

    // TODO: Upload to OVH S3 and return a signed URL valid 24h
    // For now, return the JSON directly
    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="diabeo-export-${user.id}-${Date.now()}.json"`,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[account/export GET]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
