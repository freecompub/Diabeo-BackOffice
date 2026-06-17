/**
 * Test suite : capabilities (socle d'accès 2 axes — US-2610 / F4 / F2).
 *
 * Couvre :
 *  - lecture des capacités scopées Q1/Q2 depuis `HealthcareMembership` (N-N) ;
 *  - `resolveVerificationPolicy` **fail-secure** : défaut `required`, `provisional`
 *    borné (`expiresAt` futur) et interdit en prod sans flag pilote.
 *
 * Risque clinique : la résolution de la porte d'accès clinique (Q1) doit
 * **toujours** dégrader vers `required` en cas de doute (base vide, politique
 * expirée, prod) — sinon ouverture silencieuse de l'accès PHI.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import {
  getMemberships, clinicalCapability, canManageOrg, isPrincipalAdmin,
  resolveVerificationPolicy,
} from "@/lib/capabilities"

const pm = prismaMock as unknown as {
  healthcareMembership: { findMany: any; findUnique: any }
  verificationPolicy: { findFirst: any }
}

const FUTURE = new Date("2027-01-01T00:00:00Z")
const PAST = new Date("2020-01-01T00:00:00Z")
const NOW = new Date("2026-06-17T00:00:00Z")

afterEach(() => vi.unstubAllEnvs())

describe("capabilities — lecture des capacités scopées (N-N)", () => {
  it("getMemberships retourne les appartenances du user", async () => {
    pm.healthcareMembership.findMany.mockResolvedValue([{ id: 1, userId: 5, serviceId: 9 }])
    const r = await getMemberships(5)
    expect(r).toHaveLength(1)
    expect(pm.healthcareMembership.findMany).toHaveBeenCalledWith({ where: { userId: 5 } })
  })

  it("clinicalCapability renvoie le rôle clinique du scope, ou null", async () => {
    pm.healthcareMembership.findUnique.mockResolvedValueOnce({ clinicalRole: "DOCTOR" })
    expect(await clinicalCapability(5, 9)).toBe("DOCTOR")
    pm.healthcareMembership.findUnique.mockResolvedValueOnce(null)
    expect(await clinicalCapability(5, 99)).toBeNull()
    pm.healthcareMembership.findUnique.mockResolvedValueOnce({ clinicalRole: null })
    expect(await clinicalCapability(5, 7)).toBeNull()
  })

  it("canManageOrg / isPrincipalAdmin renvoient des booléens (false par défaut)", async () => {
    pm.healthcareMembership.findUnique.mockResolvedValueOnce({ canManage: true })
    expect(await canManageOrg(5, 9)).toBe(true)
    pm.healthcareMembership.findUnique.mockResolvedValueOnce(null)
    expect(await canManageOrg(5, 9)).toBe(false)
    pm.healthcareMembership.findUnique.mockResolvedValueOnce({ isPrincipalAdmin: true })
    expect(await isPrincipalAdmin(5, 9)).toBe(true)
    pm.healthcareMembership.findUnique.mockResolvedValueOnce(null)
    expect(await isPrincipalAdmin(5, 9)).toBe(false)
  })
})

describe("resolveVerificationPolicy — fail-secure", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("VERIFICATION_ALLOW_PILOT", "")
  })

  it("aucune politique → required (défaut codé en dur)", async () => {
    pm.verificationPolicy.findFirst.mockResolvedValue(null)
    expect(await resolveVerificationPolicy({ tenantId: 1, country: "FR" }, NOW))
      .toEqual({ mode: "required", source: "default" })
  })

  it("politique tenant required → required (source tenant)", async () => {
    pm.verificationPolicy.findFirst.mockResolvedValueOnce({ mode: "required", expiresAt: null })
    expect(await resolveVerificationPolicy({ tenantId: 1 }, NOW))
      .toEqual({ mode: "required", source: "tenant" })
  })

  it("provisional borné (expiresAt futur, hors prod) → provisional", async () => {
    pm.verificationPolicy.findFirst.mockResolvedValueOnce({ mode: "provisional", expiresAt: FUTURE })
    expect(await resolveVerificationPolicy({ tenantId: 1 }, NOW))
      .toEqual({ mode: "provisional", source: "tenant" })
  })

  it("provisional sans expiresAt → dégradé en required (borne obligatoire)", async () => {
    pm.verificationPolicy.findFirst.mockResolvedValueOnce({ mode: "provisional", expiresAt: null })
    expect((await resolveVerificationPolicy({ tenantId: 1 }, NOW)).mode).toBe("required")
  })

  it("provisional expiré → dégradé en required", async () => {
    pm.verificationPolicy.findFirst.mockResolvedValueOnce({ mode: "provisional", expiresAt: PAST })
    expect((await resolveVerificationPolicy({ tenantId: 1 }, NOW)).mode).toBe("required")
  })

  it("en production, provisional dégradé en required sans flag pilote", async () => {
    vi.stubEnv("NODE_ENV", "production")
    pm.verificationPolicy.findFirst.mockResolvedValueOnce({ mode: "provisional", expiresAt: FUTURE })
    expect((await resolveVerificationPolicy({ tenantId: 1 }, NOW)).mode).toBe("required")
  })

  it("en production avec VERIFICATION_ALLOW_PILOT → provisional honoré (borné)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("VERIFICATION_ALLOW_PILOT", "true")
    pm.verificationPolicy.findFirst.mockResolvedValueOnce({ mode: "provisional", expiresAt: FUTURE })
    expect((await resolveVerificationPolicy({ tenantId: 1 }, NOW)).mode).toBe("provisional")
  })

  it("fallback pays quand aucune politique tenant", async () => {
    // 1er findFirst (tenant) → null ; 2e (pays) → provisional borné.
    pm.verificationPolicy.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ mode: "provisional", expiresAt: FUTURE })
    expect(await resolveVerificationPolicy({ tenantId: 1, country: "FR" }, NOW))
      .toEqual({ mode: "provisional", source: "country" })
  })
})
