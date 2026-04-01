import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { DeviceCategory } from "@prisma/client"
import { requireAuth, AuthError } from "@/lib/auth"
import { resolvePatientId } from "@/lib/access-control"
import { requireGdprConsent } from "@/lib/gdpr"
import { deviceService } from "@/lib/services/device.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const createDeviceSchema = z.object({
  patientId: z.number().int().positive().optional(),
  brand: z.string().max(100).optional(),
  name: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  sn: z.string().max(100).optional(),
  type: z.string().max(50).optional(),
  category: z.nativeEnum(DeviceCategory),
  connectionTypes: z.array(z.enum(["bluetooth", "usb", "api"])).optional(),
  modelIdentifier: z.string().max(100).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const patientIdParam = req.nextUrl.searchParams.get("patientId")
    const patientId = await resolvePatientId(user.id, user.role, patientIdParam ? parseInt(patientIdParam, 10) : undefined)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const ctx = extractRequestContext(req)
    const devices = await deviceService.list(patientId, user.id, ctx)
    return NextResponse.json(devices)
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[devices GET]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })

    const body = await req.json()
    const parsed = createDeviceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const { patientId: pidParam, ...deviceInput } = parsed.data
    const patientId = await resolvePatientId(user.id, user.role, pidParam)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const ctx = extractRequestContext(req)
    const device = await deviceService.create(patientId, deviceInput, user.id, ctx)
    return NextResponse.json(device, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    if (error instanceof Error && error.message === "maxDevicesReached") {
      return NextResponse.json({ error: "maxDevicesReached" }, { status: 400 })
    }
    const msg = error instanceof Error ? error.message : "Unknown error"
    console.error("[devices POST]", msg)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
