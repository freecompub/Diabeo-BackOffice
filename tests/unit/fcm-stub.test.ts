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

import { fcmService, getPushLog, _clearPushLog, type MockedPush } from "@/lib/services/fcm.service"

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

  it("accumule les push successifs dans le buffer", async () => {
    findManyMock.mockResolvedValue([
      { id: "reg-1", pushToken: "tok-1", platform: "web", userId: 1, isActive: true },
    ])
    await fcmService.sendToUser({ userId: 1, senderId: 1, title: "A", body: "1" })
    await fcmService.sendToUser({ userId: 1, senderId: 1, title: "B", body: "2" })
    const log = getPushLog()
    expect(log).toHaveLength(2)
    expect(log.map((p) => p.title)).toEqual(["A", "B"])
  })

  it("borne le buffer à 500 (ring-buffer FIFO, pas de croissance non bornée)", async () => {
    findManyMock.mockResolvedValue([
      { id: "reg-1", pushToken: "tok-1", platform: "web", userId: 1, isActive: true },
    ])
    // 501 envois → la 1re entrée doit avoir été évincée (shift), taille plafonnée.
    for (let i = 0; i < 501; i++) {
      await fcmService.sendToUser({ userId: 1, senderId: 1, title: `n-${i}`, body: "x" })
    }
    const log = getPushLog()
    expect(log).toHaveLength(500)
    expect(log[0].title).toBe("n-1") // n-0 évincé
    expect(log[log.length - 1].title).toBe("n-500")
  })

  it("getPushLog() renvoie une copie défensive (mutation sans effet sur le buffer)", async () => {
    findManyMock.mockResolvedValue([
      { id: "reg-1", pushToken: "tok-1", platform: "web", userId: 1, isActive: true },
    ])
    await fcmService.sendToUser({
      userId: 1,
      senderId: 1,
      title: "A",
      body: "1",
      data: { templateId: "t1" },
    })
    const snapshot = getPushLog() as MockedPush[]
    // (a) ajout d'élément au tableau retourné → sans effet
    snapshot.push({ token: "x", platform: "web", title: "INJECTED", body: "z", at: "" })
    // (b) mutation de l'objet `data` d'un élément capturé → sans effet (deep-clone)
    snapshot[0].data!["injected"] = "x"
    const after = getPushLog()
    expect(after).toHaveLength(1)
    expect(after[0].data).toEqual({ templateId: "t1" }) // pas de clé "injected"
  })

  it("MOCK_MODE=true stube même si une clé Firebase est présente", async () => {
    vi.stubEnv("MOCK_MODE", "true")
    vi.stubEnv("FIREBASE_SERVICE_ACCOUNT_KEY", "present")
    findManyMock.mockResolvedValue([
      { id: "reg-1", pushToken: "tok-1", platform: "web", userId: 1, isActive: true },
    ])
    const res = await fcmService.sendToUser({ userId: 1, senderId: 1, title: "x", body: "y" })
    expect(res.sent).toBe(1)
    expect(getFcmMock).not.toHaveBeenCalled()
  })
})
