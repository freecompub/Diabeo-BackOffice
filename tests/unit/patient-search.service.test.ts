/**
 * Test suite: patientService.search (US-2019)
 *
 * Behaviour tested:
 * - HMAC search emits an OR on `firstnameHmac` / `lastnameHmac`.
 * - `pathology` filter is added as an enum exact-match.
 * - `accessibleIds=null` (ADMIN) → no IN-clause; `accessibleIds=[]` →
 *   short-circuits to empty result without DB call.
 * - Cursor pagination uses `cursor: { id }` + `skip: 1`.
 * - Audit row written with `resourceId="search"` + flags in metadata.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { patientService } from "@/lib/services/patient.service"
import { Pathology } from "@prisma/client"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.patient.findMany.mockResolvedValue([])
})

describe("patientService.search", () => {
  it("short-circuits when accessibleIds is an empty array", async () => {
    const res = await patientService.search(
      { accessibleIds: [] },
      9,
    )
    expect(res.items).toEqual([])
    expect(res.nextCursor).toBeNull()
    expect(prismaMock.patient.findMany).not.toHaveBeenCalled()
  })

  it("uses OR on firstnameHmac/lastnameHmac (in) when a single name token is provided", async () => {
    await patientService.search(
      { search: "Dupont", accessibleIds: null },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    // La recherche est portée par `where.OR` (patient-level), pas `where.user`.
    expect(call.where.OR).toHaveLength(2)
    expect(call.where.OR[0].user.firstnameHmac.in).toHaveLength(1)
    expect(call.where.OR[1].user.lastnameHmac.in).toHaveLength(1)
    // `where.user` ne porte que le filtre privacy (consentement RGPD).
    expect(call.where.user).toEqual({
      privacySettings: { gdprConsent: true, shareWithProviders: true },
    })
  })

  it("tokenise une saisie multi-mots → un HMAC par mot dans le `in`", async () => {
    await patientService.search(
      { search: "Jean Dupont", accessibleIds: null },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    expect(call.where.OR).toHaveLength(2)
    // 2 mots distincts → 2 HMAC sur firstnameHmac ET lastnameHmac.
    expect(call.where.OR[0].user.firstnameHmac.in).toHaveLength(2)
    expect(call.where.OR[1].user.lastnameHmac.in).toHaveLength(2)
  })

  it("résout un token `#id` (désambiguïsation homonymes) en match direct sur l'id", async () => {
    await patientService.search(
      { search: "Jean Martin #42", accessibleIds: null },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    // 2 branches noms + 1 branche id.
    expect(call.where.OR).toHaveLength(3)
    const idBranch = call.where.OR.find((b: any) => b.id)
    expect(idBranch).toEqual({ id: { in: [42] } })
    // Les mots-noms ne contiennent jamais le token `#42`.
    expect(call.where.OR[0].user.firstnameHmac.in).toHaveLength(2)
  })

  it("token `#id` seul → uniquement la branche id (pas de HMAC vide)", async () => {
    await patientService.search(
      { search: "#7", accessibleIds: null },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    expect(call.where.OR).toEqual([{ id: { in: [7] } }])
  })

  it("filters out patients without gdprConsent + shareWithProviders (H1)", async () => {
    await patientService.search(
      { accessibleIds: [1] },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    expect(call.where.user.privacySettings).toEqual({
      gdprConsent: true, shareWithProviders: true,
    })
  })

  it("response trims to id/firstname/lastname (data-minimization)", async () => {
    prismaMock.patient.findMany.mockResolvedValueOnce([
      {
        id: 1, pathology: "DT1", createdAt: new Date(),
        user: { id: 9, firstname: "encrypted", lastname: "encrypted" },
      },
    ] as any)
    const r = await patientService.search({ accessibleIds: [1] }, 9)
    expect(r.items[0].user).not.toHaveProperty("email")
    expect(r.items[0].user).not.toHaveProperty("birthday")
  })

  it("adds pathology filter as exact match", async () => {
    await patientService.search(
      { pathology: Pathology.DT1, accessibleIds: null },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    expect(call.where.pathology).toBe(Pathology.DT1)
  })

  it("scopes via id-in when accessibleIds is a non-empty array", async () => {
    await patientService.search(
      { accessibleIds: [1, 2, 3] },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    expect(call.where.id).toEqual({ in: [1, 2, 3] })
  })

  it("paginates via cursor + skip=1", async () => {
    await patientService.search(
      { cursor: 100, limit: 10, accessibleIds: null },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    expect(call.cursor).toEqual({ id: 100 })
    expect(call.skip).toBe(1)
    expect(call.take).toBe(11)
  })

  it("emits an audit row with flags (1:1 — adoption coalescing retirée A3 round 2)", async () => {
    await patientService.search(
      { search: "Curie", pathology: Pathology.DT2, accessibleIds: [1] },
      9,
    )
    const audit = prismaMock.auditLog.create.mock.calls[0][0].data as any
    expect(audit.resource).toBe("PATIENT")
    expect(audit.resourceId).toBe("search")
    expect(audit.metadata).toMatchObject({
      hasSearch: true,
      pathology: Pathology.DT2,
      scoped: true,
    })
    // A3 round 2 — pas de marker coalesced (1:1 préservé pour forensique CNIL)
    expect(audit.metadata).not.toHaveProperty("coalesced")
  })
})
