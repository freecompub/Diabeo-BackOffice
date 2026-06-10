/**
 * @vitest-environment node
 */

/** Tests — stub push (FCM) du mode dev mocké (US-2270). */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const { findManyMock, logCreateMock, auditMock, getFcmMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  logCreateMock: vi.fn().mockResolvedValue({}),
  auditMock: vi.fn().mockResolvedValue({}),
  getFcmMock: vi.fn(() => {
    throw new Error("getFcm ne doit PAS être appelé en mode mocké")
  }),
}))

vi.mock("@/lib/db/client", () => ({
  prisma: {
    pushDeviceRegistration: { findMany: findManyMock, update: vi.fn(), findFirst: vi.fn() },
    pushNotificationLog: { create: logCreateMock },
    pushNotificationTemplate: { findUnique: vi.fn() },
  },
}))
vi.mock("@/lib/firebase/admin", () => ({ getFcm: getFcmMock }))
vi.mock("@/lib/services/audit.service", () => ({ auditService: { log: auditMock } }))

import { fcmService, getPushLog, _clearPushLog } from "@/lib/services/fcm.service"

beforeEach(() => {
  vi.clearAllMocks()
  _clearPushLog()
  vi.stubEnv("NODE_ENV", "development")
  vi.stubEnv("MOCK_MODE", "")
  vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", "")
})
afterEach(() => vi.unstubAllEnvs())

describe("fcmService.sendToUser — mode dev mocké", () => {
  it("capture le push en mémoire (getPushLog) sans appeler Firebase", async () => {
    findManyMock.mockResolvedValue([
      { id: "reg-1", pushToken: "tok-1", platform: "web", userId: 1, isActive: true },
    ])

    const res = await fcmService.sendToUser({ userId: 1, senderId: 1, title: "Rappel", body: "RDV demain" })

    expect(res).toEqual(expect.objectContaining({ sent: 1, failed: 0 }))
    expect(getFcmMock).not.toHaveBeenCalled() // Firebase jamais sollicité
    const log = getPushLog()
    expect(log).toHaveLength(1)
    expect(log[0]).toEqual(expect.objectContaining({ token: "tok-1", platform: "web", title: "Rappel", body: "RDV demain" }))
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CREATE", resource: "PUSH_NOTIFICATION" }),
    )
  })

  it("sans device enregistré → aucun envoi", async () => {
    findManyMock.mockResolvedValue([])
    const res = await fcmService.sendToUser({ userId: 1, senderId: 1, title: "x", body: "y" })
    expect(res).toEqual({ sent: 0, failed: 0, results: [] })
    expect(getPushLog()).toHaveLength(0)
  })
})
