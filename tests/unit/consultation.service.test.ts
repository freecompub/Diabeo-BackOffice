/**
 * @vitest-environment node
 */

/**
 * Tests — consultation.service (US-2018b, référence patient éphémère).
 *
 * Comportements cliniques/sécurité vérifiés :
 * - ouverture : résolution publicRef→id, contrôle d'accès, émission jeton, audit ;
 * - non-énumération : accès refusé renvoie la MÊME erreur que patient inexistant ;
 * - binding anti-partage : un jeton ne résout que pour son utilisateur émetteur ;
 * - single-active : ouvrir un patient invalide le jeton précédent ;
 * - fermeture : jeton non rejouable après close.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { store, canAccessMock, findFirstMock, auditMock } = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  canAccessMock: vi.fn(),
  findFirstMock: vi.fn(),
  auditMock: vi.fn().mockResolvedValue({}),
}))

vi.mock("@/lib/cache/redis-cache", () => ({
  cacheGet: vi.fn(async (bucket: string, key: string) => store.get(`${bucket}:${key}`)),
  cacheSet: vi.fn(async (bucket: string, key: string, value: unknown) => {
    store.set(`${bucket}:${key}`, value)
  }),
  cacheDelete: vi.fn(async (bucket: string, key: string) => {
    store.delete(`${bucket}:${key}`)
  }),
}))

vi.mock("@/lib/access-control", () => ({ canAccessPatient: canAccessMock }))
vi.mock("@/lib/db/client", () => ({ prisma: { patient: { findFirst: findFirstMock } } }))
vi.mock("@/lib/services/audit.service", () => ({ auditService: { log: auditMock } }))

import {
  openConsultation,
  resolveConsultation,
  closeConsultation,
} from "@/lib/services/consultation.service"

const REF = "11111111-1111-1111-1111-111111111111"

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
  findFirstMock.mockResolvedValue({ id: 42 })
  canAccessMock.mockResolvedValue(true)
})

describe("openConsultation", () => {
  it("émet un jeton, stocke {userId,patientId} et audite l'accès", async () => {
    const res = await openConsultation(7, "DOCTOR", REF)
    expect("cTok" in res && res.cTok).toBeTruthy()
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "READ", resource: "PATIENT", resourceId: "42" }),
    )
    // le jeton résout bien vers le patient pour cet utilisateur
    const cTok = (res as { cTok: string }).cTok
    expect(await resolveConsultation(cTok, 7)).toBe(42)
  })

  it("patient inexistant → patientNotFound", async () => {
    findFirstMock.mockResolvedValue(null)
    expect(await openConsultation(7, "DOCTOR", REF)).toEqual({ error: "patientNotFound" })
  })

  it("accès refusé → MÊME erreur neutre que patient inexistant (anti-énumération)", async () => {
    canAccessMock.mockResolvedValue(false)
    expect(await openConsultation(7, "DOCTOR", REF)).toEqual({ error: "patientNotFound" })
  })

  it("single-active : ouvrir un nouveau patient invalide le jeton précédent", async () => {
    const first = (await openConsultation(7, "DOCTOR", REF)) as { cTok: string }
    const second = (await openConsultation(7, "DOCTOR", REF)) as { cTok: string }
    expect(await resolveConsultation(first.cTok, 7)).toBeNull() // ancien révoqué
    expect(await resolveConsultation(second.cTok, 7)).toBe(42) // nouveau valide
  })
})

describe("resolveConsultation", () => {
  it("refuse un jeton présenté par un autre utilisateur (binding anti-partage)", async () => {
    const { cTok } = (await openConsultation(7, "DOCTOR", REF)) as { cTok: string }
    expect(await resolveConsultation(cTok, 99)).toBeNull()
    expect(await resolveConsultation(cTok, 7)).toBe(42)
  })

  it("jeton inconnu → null", async () => {
    expect(await resolveConsultation("nope", 7)).toBeNull()
  })
})

describe("closeConsultation", () => {
  it("rend le jeton non rejouable", async () => {
    const { cTok } = (await openConsultation(7, "DOCTOR", REF)) as { cTok: string }
    await closeConsultation(cTok, 7)
    expect(await resolveConsultation(cTok, 7)).toBeNull()
  })
})
