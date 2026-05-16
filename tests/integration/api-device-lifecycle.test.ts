/**
 * @description Groupe 4 — Integration tests des 3 routes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/db/client", () => ({ prisma: {} }))

vi.mock("@/lib/gdpr", () => ({
  requireGdprConsent: vi.fn().mockResolvedValue(true),
  invalidateGdprConsentCache: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/services/device-lifecycle.service", async (orig) => {
  const actual = await orig<typeof import("@/lib/services/device-lifecycle.service")>()
  return {
    ...actual,
    supportedDeviceService: {
      search: vi.fn(),
      isSupported: vi.fn(),
      create: vi.fn(),
    },
    deviceLifecycleService: {
      revoke: vi.fn(),
      listHistory: vi.fn(),
    },
  }
})

import {
  supportedDeviceService,
  deviceLifecycleService,
  DeviceLifecycleNotFoundError,
  DeviceLifecycleAccessError,
  DeviceLifecycleValidationError,
} from "@/lib/services/device-lifecycle.service"

const { GET: compatGET, POST: compatPOST } = await import(
  "@/app/api/devices/compatibility/route"
)
const { POST: revokePOST } = await import(
  "@/app/api/patients/[id]/devices/[deviceId]/revoke/route"
)
const { GET: historyGET } = await import(
  "@/app/api/patients/[id]/devices/history/route"
)

function makeReq(
  url: string,
  init: RequestInit & { auth?: boolean; role?: string } = {},
): NextRequest {
  const headers = new Headers(init.headers)
  if (init.auth !== false) {
    headers.set("x-user-id", "1")
    headers.set("x-user-role", init.role ?? "NURSE")
  }
  return new NextRequest(new URL(url, "http://test.local"), {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ────────────────────────────────────────────────────────────────
// GET /api/devices/compatibility
// ────────────────────────────────────────────────────────────────

describe("GET /api/devices/compatibility", () => {
  it("200 returns supported devices", async () => {
    vi.mocked(supportedDeviceService.search).mockResolvedValue([
      { id: 1, brand: "Dexcom", model: "G7", category: "cgm",
        modelIdentifier: null, connectionTypes: ["bluetooth"],
        sensorLifetimeDays: 10, isHdsCertified: true, notes: null, isActive: true },
    ] as any)
    const res = await compatGET(makeReq("/api/devices/compatibility?category=cgm"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
  })

  it("401 sans JWT", async () => {
    const res = await compatGET(
      makeReq("/api/devices/compatibility", { auth: false }),
    )
    expect(res.status).toBe(401)
  })

  it("403 si VIEWER (minRole NURSE)", async () => {
    const res = await compatGET(
      makeReq("/api/devices/compatibility", { role: "VIEWER" }),
    )
    expect(res.status).toBe(403)
  })

  it("400 si query invalide", async () => {
    const res = await compatGET(
      makeReq("/api/devices/compatibility?category=INVALID"),
    )
    expect(res.status).toBe(400)
  })
})

describe("POST /api/devices/compatibility", () => {
  it("201 admin crée entry", async () => {
    vi.mocked(supportedDeviceService.create).mockResolvedValue({
      id: 1, brand: "Abbott", model: "FSL3", category: "cgm",
      modelIdentifier: null, connectionTypes: ["nfc"],
      sensorLifetimeDays: 14, isHdsCertified: true, notes: null, isActive: true,
    } as any)
    const res = await compatPOST(makeReq("/api/devices/compatibility", {
      method: "POST", role: "ADMIN",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brand: "Abbott", model: "FSL3", category: "cgm", sensorLifetimeDays: 14 }),
    }))
    expect(res.status).toBe(201)
  })

  it("403 si non-ADMIN", async () => {
    const res = await compatPOST(makeReq("/api/devices/compatibility", {
      method: "POST", role: "DOCTOR",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brand: "X", model: "Y", category: "cgm" }),
    }))
    expect(res.status).toBe(403)
  })

  it("422 si validation fail", async () => {
    const res = await compatPOST(makeReq("/api/devices/compatibility", {
      method: "POST", role: "ADMIN",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brand: "X", model: "Y", category: "INVALID" }),
    }))
    expect(res.status).toBe(422)
  })

  it("422 si alreadyExists (P2002)", async () => {
    vi.mocked(supportedDeviceService.create).mockRejectedValue(
      new DeviceLifecycleValidationError("brand_model_category", "alreadyExists"),
    )
    const res = await compatPOST(makeReq("/api/devices/compatibility", {
      method: "POST", role: "ADMIN",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brand: "Dexcom", model: "G7", category: "cgm" }),
    }))
    expect(res.status).toBe(422)
  })
})

// ────────────────────────────────────────────────────────────────
// POST /api/patients/[id]/devices/[deviceId]/revoke
// ────────────────────────────────────────────────────────────────

describe("POST /api/patients/[id]/devices/[deviceId]/revoke", () => {
  it("200 revoke success", async () => {
    vi.mocked(deviceLifecycleService.revoke).mockResolvedValue({
      revoked: true, alreadyRevoked: false,
    })
    const res = await revokePOST(
      makeReq("/api/patients/42/devices/10/revoke", {
        method: "POST", role: "DOCTOR",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Remplacé" }),
      }),
      { params: Promise.resolve({ id: "42", deviceId: "10" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.revoked).toBe(true)
  })

  it("403 forbidden RBAC fail", async () => {
    vi.mocked(deviceLifecycleService.revoke).mockRejectedValue(
      new DeviceLifecycleAccessError(),
    )
    const res = await revokePOST(
      makeReq("/api/patients/42/devices/10/revoke", {
        method: "POST", role: "DOCTOR",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "x" }),
      }),
      { params: Promise.resolve({ id: "42", deviceId: "10" }) },
    )
    expect(res.status).toBe(403)
  })

  it("404 if device not found", async () => {
    vi.mocked(deviceLifecycleService.revoke).mockRejectedValue(
      new DeviceLifecycleNotFoundError(),
    )
    const res = await revokePOST(
      makeReq("/api/patients/42/devices/99/revoke", {
        method: "POST", role: "DOCTOR",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "x" }),
      }),
      { params: Promise.resolve({ id: "42", deviceId: "99" }) },
    )
    expect(res.status).toBe(404)
  })

  it("422 si reason vide", async () => {
    const res = await revokePOST(
      makeReq("/api/patients/42/devices/10/revoke", {
        method: "POST", role: "DOCTOR",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "" }),
      }),
      { params: Promise.resolve({ id: "42", deviceId: "10" }) },
    )
    expect(res.status).toBe(422)
  })

  it("403 gdprConsentRequired si user a révoqué", async () => {
    const { requireGdprConsent } = await import("@/lib/gdpr")
    vi.mocked(requireGdprConsent).mockResolvedValueOnce(false)
    const res = await revokePOST(
      makeReq("/api/patients/42/devices/10/revoke", {
        method: "POST", role: "DOCTOR",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "x" }),
      }),
      { params: Promise.resolve({ id: "42", deviceId: "10" }) },
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("gdprConsentRequired")
  })
})

// ────────────────────────────────────────────────────────────────
// GET /api/patients/[id]/devices/history
// ────────────────────────────────────────────────────────────────

describe("GET /api/patients/[id]/devices/history", () => {
  it("200 retourne history triée", async () => {
    vi.mocked(deviceLifecycleService.listHistory).mockResolvedValue([
      { id: 1, patientId: 42, brand: "Dexcom", model: "G7", category: "cgm",
        sn: null, date: null, isActive: false, revokedAt: new Date(),
        revokedBy: null, revokedReason: null, batteryLevel: null,
        sensorExpiresAt: null, lastSyncAt: null },
    ] as any)
    const res = await historyGET(
      makeReq("/api/patients/42/devices/history", { role: "DOCTOR" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toContain("no-store")
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].isActive).toBe(false)
  })

  it("403 if not authorized", async () => {
    vi.mocked(deviceLifecycleService.listHistory).mockRejectedValue(
      new DeviceLifecycleAccessError(),
    )
    const res = await historyGET(
      makeReq("/api/patients/42/devices/history", { role: "DOCTOR" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(403)
  })

  it("400 si query invalide", async () => {
    const res = await historyGET(
      makeReq("/api/patients/42/devices/history?limit=abc", { role: "DOCTOR" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(400)
  })

  it("403 gdprConsentRequired", async () => {
    const { requireGdprConsent } = await import("@/lib/gdpr")
    vi.mocked(requireGdprConsent).mockResolvedValueOnce(false)
    const res = await historyGET(
      makeReq("/api/patients/42/devices/history", { role: "DOCTOR" }),
      { params: Promise.resolve({ id: "42" }) },
    )
    expect(res.status).toBe(403)
  })
})
