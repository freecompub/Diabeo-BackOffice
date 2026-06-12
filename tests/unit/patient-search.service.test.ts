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
    // `where.user` ne porte que le filtre privacy (consentement RGPD), aligné
    // sur listByDoctor : OR (pas de row) OR (consentement confirmé).
    expect(call.where.user).toEqual({
      OR: [
        { privacySettings: null },
        { privacySettings: { gdprConsent: true, shareWithProviders: true } },
      ],
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

  it("SECURITY — un token `#id` ne contourne PAS le scope RBAC (id-in top-level ANDé)", async () => {
    // Un PS sonde `#99` alors que son périmètre = [1, 2]. Le match `#id` est
    // dans `where.OR`, mais `where.id = { in: accessibleIds }` reste top-level
    // → Prisma applique `id ∈ [1,2] AND (… OR id ∈ [99])` : #99 hors périmètre
    // ne peut pas être exfiltré.
    await patientService.search(
      { search: "#99", accessibleIds: [1, 2] },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    // Scope top-level conservé (ANDé avec le OR).
    expect(call.where.id).toEqual({ in: [1, 2] })
    // La branche id de la recherche existe mais reste contrainte par le scope.
    expect(call.where.OR).toEqual([{ id: { in: [99] } }])
  })

  it("filters consent (H1) en autorisant les patients sans row privacySettings (aligné listByDoctor)", async () => {
    await patientService.search(
      { accessibleIds: [1] },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    // OR (pas encore de row — patient fraîchement créé) OR (consentement confirmé).
    // Un patient avec une row présente mais un flag false reste exclu (opt-out).
    expect(call.where.user.OR).toEqual([
      { privacySettings: null },
      { privacySettings: { gdprConsent: true, shareWithProviders: true } },
    ])
  })

  it("cap défensif : au-delà de 8 tokens, seuls les 8 premiers sont matchés", async () => {
    // 10 mots distincts → tokenisation tronquée à 8 → 8 HMAC max dans le `in`.
    await patientService.search(
      { search: "a b c d e f g h i j", accessibleIds: null },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    expect(call.where.OR[0].user.firstnameHmac.in).toHaveLength(8)
    expect(call.where.OR[1].user.lastnameHmac.in).toHaveLength(8)
  })

  it("fallback : saisie blancs-only → pas de branche `OR` de recherche", async () => {
    await patientService.search(
      { search: "   ", accessibleIds: [1] },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    expect(call.where.OR).toBeUndefined()
  })

  it("fallback : `#id` non-safe-integer → token ignoré, pas de branche `OR`", async () => {
    // `#99999999999999999999` matche /^#\d+$/ (donc exclu des noms) mais échoue
    // Number.isSafeInteger → idTokens vide → searchOr undefined (liste scopée
    // renvoyée, JAMAIS hors scope car `id IN accessibleIds` reste top-level).
    await patientService.search(
      { search: "#99999999999999999999", accessibleIds: [1] },
      9,
    )
    const call = prismaMock.patient.findMany.mock.calls[0][0] as any
    expect(call.where.OR).toBeUndefined()
    expect(call.where.id).toEqual({ in: [1] })
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
