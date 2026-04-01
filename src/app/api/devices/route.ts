import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { DeviceCategory } from "@prisma/client"
import { requireAuth, AuthError } from "@/lib/auth"
import { getOwnPatientId } from "@/lib/access-control"
import { deviceService } from "@/lib/services/device.service"
import { extractRequestContext } from "@/lib/services/audit.service"

const createDeviceSchema = z.object({
  brand: z.string().max(100).optional(),
  name: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  sn: z.string().max(100).optional(),
  type: z.string().max(50).optional(),
  category: z.nativeEnum(DeviceCategory).optional(),
  connectionTypes: z.array(z.enum(["bluetooth", "usb", "api"])).optional(),
  modelIdentifier: z.string().max(100).optional(),
})

export async function GET(req: NextRequest) {
  try {
    const user = requireAuth(req)
    const patientId = await getOwnPatientId(user.id)
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
    const patientId = await getOwnPatientId(user.id)
    if (!patientId) return NextResponse.json({ error: "patientNotFound" }, { status: 404 })

    const body = await req.json()
    const parsed = createDeviceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: "validationFailed", details: parsed.error.flatten().fieldErrors }, { status: 400 })
    }

    const ctx = extractRequestContext(req)
    const device = await deviceService.create(patientId, parsed.data, user.id, ctx)
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
