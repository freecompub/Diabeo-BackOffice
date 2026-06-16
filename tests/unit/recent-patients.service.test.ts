/**
 * Test suite : recent-patients.service (US-2603 — switcher de contexte patient).
 *
 * Comportements de sécurité couverts :
 *  - **Scope dur** : la liste récents/épinglés est TOUJOURS intersectée avec
 *    `getAccessiblePatientIds` (anti-fuite hors périmètre) + `deletedAt: null`.
 *  - Portefeuille vide → aucune requête, retour vide.
 *  - ADMIN (null) → pas de filtre d'IDs.
 *  - `recordView` upsert idempotent (re-vue = update viewedAt).
 *  - `pin` plafonné, `unpin` idempotent ; audit CREATE/DELETE PINNED_PATIENT.
 *  - Noms déchiffrés serveur (PII).
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/access-control", () => ({
  getAccessiblePatientIds: vi.fn(),
}))
vi.mock("@/lib/crypto/fields", () => ({
  safeDecryptField: (v: string | null) => (v ? `dec:${v}` : v),
}))

import { recentPatientsService } from "@/lib/services/recent-patients.service"
import { getAccessiblePatientIds } from "@/lib/access-control"

const mockedAccessible = vi.mocked(getAccessiblePatientIds)
const pm = prismaMock as unknown as {
  recentlyViewedPatient: { findMany: any; upsert: any }
  pinnedPatient: { findMany: any; upsert: any; deleteMany: any; count: any; findUnique: any }
  auditLog: { create: any }
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  mockedAccessible.mockReset()
})

const row = (id: number, fn: string, ln: string, pathology = "DT1") => ({
  patient: { id, publicRef: `ref-${id}`, pathology, user: { firstname: fn, lastname: ln } },
})

describe("recentPatientsService.listRecentAndPinned", () => {
  it("returns empty without querying when the portfolio is empty", async () => {
    mockedAccessible.mockResolvedValue([])
    const out = await recentPatientsService.listRecentAndPinned(1, "DOCTOR", 1)
    expect(out).toEqual({ recent: [], pinned: [] })
    expect(pm.recentlyViewedPatient.findMany).not.toHaveBeenCalled()
  })

  it("intersects recent/pinned with the accessible scope (anti-leak) + deletedAt null", async () => {
    mockedAccessible.mockResolvedValue([10, 20])
    pm.recentlyViewedPatient.findMany.mockResolvedValue([row(10, "Jean", "Dupont")])
    pm.pinnedPatient.findMany.mockResolvedValue([row(20, "Marie", "Curie")])

    const out = await recentPatientsService.listRecentAndPinned(1, "DOCTOR", 1)

    // Le filtre de scope est appliqué dans les DEUX requêtes.
    const recentWhere = pm.recentlyViewedPatient.findMany.mock.calls[0][0].where
    const pinnedWhere = pm.pinnedPatient.findMany.mock.calls[0][0].where
    expect(recentWhere).toMatchObject({ userId: 1, patientId: { in: [10, 20] }, patient: { deletedAt: null } })
    expect(pinnedWhere).toMatchObject({ userId: 1, patientId: { in: [10, 20] }, patient: { deletedAt: null } })

    // Noms déchiffrés serveur.
    expect(out.recent[0]).toEqual({ id: 10, publicRef: "ref-10", name: "dec:Jean dec:Dupont", pathology: "DT1" })
    expect(out.pinned[0].name).toBe("dec:Marie dec:Curie")
  })

  it("applies NO id filter for ADMIN (accessible = null)", async () => {
    mockedAccessible.mockResolvedValue(null)
    pm.recentlyViewedPatient.findMany.mockResolvedValue([])
    pm.pinnedPatient.findMany.mockResolvedValue([])
    await recentPatientsService.listRecentAndPinned(9, "ADMIN", 9)
    const where = pm.recentlyViewedPatient.findMany.mock.calls[0][0].where
    expect(where.patientId).toBeUndefined()
    expect(where).toMatchObject({ userId: 9, patient: { deletedAt: null } })
  })

  it("audits a summary row (resource PATIENT, kind patient.switcher)", async () => {
    mockedAccessible.mockResolvedValue([10])
    pm.recentlyViewedPatient.findMany.mockResolvedValue([row(10, "A", "B")])
    pm.pinnedPatient.findMany.mockResolvedValue([])
    await recentPatientsService.listRecentAndPinned(1, "DOCTOR", 1)
    const summary = prismaMock.auditLog.create.mock.calls[0][0].data as any
    expect(summary.resource).toBe("PATIENT")
    expect(summary.metadata.kind).toBe("patient.switcher")
  })
})

describe("recentPatientsService.recordView", () => {
  it("upserts on (userId, patientId), refreshing viewedAt", async () => {
    pm.recentlyViewedPatient.upsert.mockResolvedValue({} as any)
    await recentPatientsService.recordView(1, 10)
    const arg = pm.recentlyViewedPatient.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ userId_patientId: { userId: 1, patientId: 10 } })
    expect(arg.create).toEqual({ userId: 1, patientId: 10 })
    expect(arg.update).toHaveProperty("viewedAt")
  })
})

describe("recentPatientsService.pin / unpin", () => {
  it("pins and audits CREATE PINNED_PATIENT", async () => {
    pm.pinnedPatient.findUnique.mockResolvedValue(null)
    pm.pinnedPatient.count.mockResolvedValue(0)
    pm.pinnedPatient.upsert.mockResolvedValue({} as any)
    const r = await recentPatientsService.pin(1, 10, 1)
    expect(r).toEqual({ ok: true })
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("CREATE")
    expect(audit.resource).toBe("PINNED_PATIENT")
    expect(audit.metadata.patientId).toBe(10)
  })

  it("refuses to pin beyond the cap (returns pinnedLimitReached)", async () => {
    pm.pinnedPatient.findUnique.mockResolvedValue(null)
    pm.pinnedPatient.count.mockResolvedValue(20)
    const r = await recentPatientsService.pin(1, 10, 1)
    expect(r).toEqual({ ok: false, reason: "pinnedLimitReached" })
    expect(pm.pinnedPatient.upsert).not.toHaveBeenCalled()
  })

  it("re-pinning an already-pinned patient bypasses the cap", async () => {
    pm.pinnedPatient.findUnique.mockResolvedValue({ id: 1 })
    pm.pinnedPatient.upsert.mockResolvedValue({} as any)
    const r = await recentPatientsService.pin(1, 10, 1)
    expect(r).toEqual({ ok: true })
    expect(pm.pinnedPatient.count).not.toHaveBeenCalled()
  })

  it("unpins (deleteMany) and audits DELETE", async () => {
    pm.pinnedPatient.deleteMany.mockResolvedValue({ count: 1 } as any)
    await recentPatientsService.unpin(1, 10, 1)
    expect(pm.pinnedPatient.deleteMany.mock.calls[0][0]).toEqual({ where: { userId: 1, patientId: 10 } })
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("DELETE")
    expect(audit.resource).toBe("PINNED_PATIENT")
  })
})
