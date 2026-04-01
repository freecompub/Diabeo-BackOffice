import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAuth, AuthError } from "@/lib/auth"
import { prisma } from "@/lib/db/client"
import { auditService } from "@/lib/services/audit.service"

const updateUnitsSchema = z.object({
  unitGlycemia: z.union([z.literal(3), z.literal(4), z.literal(5)]).optional(),
  unitWeight: z.union([z.literal(6), z.literal(7)]).optional(),
  unitSize: z.union([z.literal(8), z.literal(9)]).optional(),
  unitCarb: z.union([z.literal(1), z.literal(2)]).optional(),
  unitHba1c: z.union([z.literal(10), z.literal(11)]).optional(),
  unitCarbExchangeNb: z.literal(15).optional(),
  unitKetones: z.union([z.literal(12), z.literal(13)]).optional(),
  unitBloodPressure: z.literal(14).optional(),
})

const UNIT_DEFAULTS = {
  unitGlycemia: 5,
  unitWeight: 6,
  unitSize: 8,
  unitCarb: 2,
  unitHba1c: 10,
  unitCarbExchangeNb: 15,
  unitKetones: 12,
  unitBloodPressure: 14,
} as const

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)

    const prefs = await prisma.userUnitPreferences.findUnique({
      where: { userId: user.id },
    })

    // Return defaults without persisting if no record exists (idempotent GET)
    return NextResponse.json(prefs ?? { userId: user.id, ...UNIT_DEFAULTS })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account/units GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const body = await req.json()
    const parsed = updateUnitsSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
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
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[account/units PUT]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
