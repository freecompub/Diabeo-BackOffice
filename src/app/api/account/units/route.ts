import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { auditService } from "@/lib/services/audit.service"

const unitCodes = z.number().int().min(1).max(15)

const updateUnitsSchema = z.object({
  unitGlycemia: unitCodes.optional(),
  unitWeight: unitCodes.optional(),
  unitSize: unitCodes.optional(),
  unitCarb: unitCodes.optional(),
  unitHba1c: unitCodes.optional(),
  unitCarbExchangeNb: unitCodes.optional(),
  unitKetones: unitCodes.optional(),
  unitBloodPressure: unitCodes.optional(),
})

export async function GET(req: Request) {
  try {
    const user = requireAuth(req)

    let prefs = await prisma.userUnitPreferences.findUnique({
      where: { userId: user.id },
    })

    // Create defaults if not exists
    if (!prefs) {
      prefs = await prisma.userUnitPreferences.create({
        data: { userId: user.id },
      })
    }

    return NextResponse.json(prefs)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[account/units GET]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = updateUnitsSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }

    const prefs = await prisma.userUnitPreferences.upsert({
      where: { userId: user.id },
      update: parsed.data,
      create: { userId: user.id, ...parsed.data },
    })

    await auditService.log({
      userId: user.id,
      action: "UPDATE",
      resource: "USER",
      resourceId: String(user.id),
      metadata: { field: "unitPreferences", updatedFields: Object.keys(parsed.data) },
    })

    return NextResponse.json(prefs)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[account/units PUT]", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
