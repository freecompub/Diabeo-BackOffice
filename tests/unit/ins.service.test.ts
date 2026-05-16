/**
 * @description US-2026 — INS (Identite Nationale Sante) unit tests round 2.
 *
 * Couvre :
 *   - validation Luhn-97 (cas valides + invalides + edge)
 *   - normalisation espaces / format
 *   - encrypt round-trip + HMAC stable
 *   - service set/get/clear (audit, collision, idempotence)
 *   - round 2 : qualityStatus, traitsHash, collidingUserIdHmac, P2002,
 *               rate-limit anti-enumeration, previousInsHmac chaînage,
 *               canBeSharedExternally guard
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { Prisma } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"

import {
  insService,
  isValidInsFormat,
  normalizeIns,
  computeTraitsHash,
  InsValidationError,
  InsCollisionError,
  InsCollisionRateLimitError,
  InsNotFoundError,
} from "@/lib/services/ins.service"

const ctx = {
  ipAddress: "1.2.3.4",
  userAgent: "Chrome",
  requestId: "req-ins-1",
}

// Fixtures INS valides (Luhn-97 calcule) :
//   1900175001001 + cle (96) = 190017500100196  -> H 1990/jan/75001
//   2900175001001 + cle (46) = 290017500100146  -> F 1990/jan/75001
const VALID_INS_M = "190017500100196"
const VALID_INS_F = "290017500100146"
const INVALID_INS_LUHN = "290017500100199" // cle fausse

// Mock User row par defaut pour traits hash.
const TRAITS_USER = {
  firstnameHmac: "fn-hmac",
  lastnameHmac: "ln-hmac",
  birthday: new Date("1990-01-15"),
  sex: "M",
  codeBirthPlace: "75056",
  insHmac: null as string | null,
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.auditLog.count.mockResolvedValue(0 as any) // rate-limit pass par defaut
  prismaMock.user.findUnique.mockResolvedValue({ ...TRAITS_USER } as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

// ────────────────────────────────────────────────────────────────
// Helpers purs
// ────────────────────────────────────────────────────────────────

describe("isValidInsFormat", () => {
  it("accepte INS valide H 15 chiffres + cle Luhn-97", () => {
    expect(isValidInsFormat(VALID_INS_M)).toBe(true)
  })

  it("accepte INS valide F (cle distincte)", () => {
    expect(isValidInsFormat(VALID_INS_F)).toBe(true)
  })

  it("rejette longueur != 15", () => {
    expect(isValidInsFormat("12345")).toBe(false)
    expect(isValidInsFormat("1234567890123456")).toBe(false)
  })

  it("rejette non-digits", () => {
    expect(isValidInsFormat("19001A500100196")).toBe(false)
    expect(isValidInsFormat("1 90017500100196")).toBe(false)
  })

  it("rejette cle Luhn-97 incorrecte", () => {
    expect(isValidInsFormat(INVALID_INS_LUHN)).toBe(false)
  })

  it("rejette non-string", () => {
    expect(isValidInsFormat(undefined as any)).toBe(false)
    expect(isValidInsFormat(null as any)).toBe(false)
    expect(isValidInsFormat(123 as any)).toBe(false)
  })
})

describe("normalizeIns", () => {
  it("retire espaces internes", () => {
    expect(normalizeIns("1 90 01 75 00 100 196")).toBe(VALID_INS_M)
  })
  it("trim whitespace alentour", () => {
    expect(normalizeIns("  190017500100196  ")).toBe(VALID_INS_M)
  })
})

describe("computeTraitsHash", () => {
  it("est deterministe pour memes traits", () => {
    const h1 = computeTraitsHash(TRAITS_USER)
    const h2 = computeTraitsHash(TRAITS_USER)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it("differe si un trait change", () => {
    const h1 = computeTraitsHash(TRAITS_USER)
    const h2 = computeTraitsHash({ ...TRAITS_USER, sex: "F" })
    expect(h1).not.toBe(h2)
  })

  it("gere les nulls (gracefully)", () => {
    const h = computeTraitsHash({
      firstnameHmac: null, lastnameHmac: null, birthday: null,
      sex: null, codeBirthPlace: null,
    })
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ────────────────────────────────────────────────────────────────
// insService.setIns
// ────────────────────────────────────────────────────────────────

describe("insService.setIns", () => {
  it("rejette format invalide (longueur)", async () => {
    await expect(
      insService.setIns(42, "12345", 9, "DOCTOR", ctx),
    ).rejects.toBeInstanceOf(InsValidationError)
  })

  it("rejette Luhn-97 fausse", async () => {
    await expect(
      insService.setIns(42, INVALID_INS_LUHN, 9, "DOCTOR", ctx),
    ).rejects.toBeInstanceOf(InsValidationError)
  })

  it("normalise espaces + valide + persiste", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null) // pas de collision
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    const out = await insService.setIns(42, "1 90017500 100196", 9, "DOCTOR", ctx)
    expect(out.updated).toBe(true)
    expect(out.qualityStatus).toBe("saisi_non_verifie")
    const upd = prismaMock.user.updateMany.mock.calls[0]![0]!.data as any
    expect(upd.ins).toBeTruthy()
    expect(upd.ins).not.toContain("190017500100196") // chiffre
    expect(upd.insHmac).toMatch(/^[0-9a-f]{64}$/)
    expect(upd.insQualityStatus).toBe("saisi_non_verifie")
    expect(upd.insSetAt).toBeInstanceOf(Date)
    expect(upd.insSetByUserId).toBe(9)
    expect(upd.insTraitsHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("collision : audit collidingUserIdHmac (H1) + throw InsCollisionError", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 99 } as any)
    await expect(
      insService.setIns(42, VALID_INS_M, 9, "DOCTOR", ctx),
    ).rejects.toBeInstanceOf(InsCollisionError)
    const audit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.action === "UNAUTHORIZED" && d.metadata?.kind === "user.ins.collision"
    })
    expect(audit).toBeDefined()
    const meta = (audit![0].data as any).metadata
    // H1 review — pas de collidingUserId clair, juste un HMAC opaque.
    expect(meta.collidingUserId).toBeUndefined()
    expect(meta.collidingUserIdHmac).toMatch(/^[0-9a-f]{64}$/)
  })

  it("404 si User cible introuvable (findUnique null)", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null) // pas de collision
    prismaMock.user.findUnique.mockResolvedValue(null) // user inexistant
    await expect(
      insService.setIns(999, VALID_INS_M, 9, "DOCTOR", ctx),
    ).rejects.toBeInstanceOf(InsNotFoundError)
  })

  it("audit kind=user.ins.set + qualityStatus + setByRole + pivot patientId", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    await insService.setIns(42, VALID_INS_M, 9, "DOCTOR", ctx, { patientId: 7 })
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.kind).toBe("user.ins.set")
    expect(audit.metadata.qualityStatus).toBe("saisi_non_verifie")
    expect(audit.metadata.setByRole).toBe("DOCTOR")
    expect(audit.metadata.patientId).toBe(7)
    expect(audit.resourceId).toBe("42")
  })

  it("chaining previousInsHmac (LOW) si User avait deja un INS", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.findUnique.mockResolvedValue({
      ...TRAITS_USER, insHmac: "old-hmac-deadbeef",
    } as any)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    await insService.setIns(42, VALID_INS_M, 9, "DOCTOR", ctx)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.previousInsHmac).toBe("old-hmac-deadbeef")
  })

  it("HMAC deterministe : meme INS → meme insHmac", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    await insService.setIns(42, VALID_INS_M, 9, "DOCTOR", ctx)
    const h1 = (prismaMock.user.updateMany.mock.calls[0]![0]!.data as any).insHmac
    await insService.setIns(43, VALID_INS_M, 9, "DOCTOR", ctx)
    const h2 = (prismaMock.user.updateMany.mock.calls[1]![0]!.data as any).insHmac
    expect(h1).toBe(h2)
  })

  it("HMAC distinct pour 2 INS differents", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    await insService.setIns(42, VALID_INS_M, 9, "DOCTOR", ctx)
    const hM = (prismaMock.user.updateMany.mock.calls[0]![0]!.data as any).insHmac
    await insService.setIns(43, VALID_INS_F, 9, "DOCTOR", ctx)
    const hF = (prismaMock.user.updateMany.mock.calls[1]![0]!.data as any).insHmac
    expect(hM).not.toBe(hF)
  })

  it("Ciphertext IV-random : 2 set du meme INS produisent ciphertext distincts", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    await insService.setIns(42, VALID_INS_M, 9, "DOCTOR", ctx)
    const c1 = (prismaMock.user.updateMany.mock.calls[0]![0]!.data as any).ins
    await insService.setIns(43, VALID_INS_M, 9, "DOCTOR", ctx)
    const c2 = (prismaMock.user.updateMany.mock.calls[1]![0]!.data as any).ins
    expect(c1).not.toBe(c2)
  })

  // H4 round 2 — P2002 race condition
  it("H4 — P2002 race condition (count=1 mais P2002 sur updateMany) → InsCollisionError", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null) // pas de collision detectee
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["ins_hmac"] },
    })
    prismaMock.user.updateMany.mockRejectedValue(p2002)
    await expect(
      insService.setIns(42, VALID_INS_M, 9, "DOCTOR", ctx),
    ).rejects.toBeInstanceOf(InsCollisionError)
  })

  it("H4 — P2002 sur autre colonne (pas ins_hmac) → throw brut (pas remappe)", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["email_hmac"] }, // pas notre colonne
    })
    prismaMock.user.updateMany.mockRejectedValue(p2002)
    await expect(
      insService.setIns(42, VALID_INS_M, 9, "DOCTOR", ctx),
    ).rejects.toBe(p2002)
  })

  // H2 round 2 — rate-limit anti-enumeration
  it("H2 — rate-limit 5 collisions/24h → InsCollisionRateLimitError 429", async () => {
    prismaMock.auditLog.count.mockResolvedValue(5 as any) // au seuil
    await expect(
      insService.setIns(42, VALID_INS_M, 9, "DOCTOR", ctx),
    ).rejects.toBeInstanceOf(InsCollisionRateLimitError)
    // Audit row `user.ins.rate_limited` emis (SOC).
    const rl = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === "user.ins.rate_limited"
    })
    expect(rl).toBeDefined()
  })

  it("H2 — count=4 sous le seuil → passe", async () => {
    prismaMock.auditLog.count.mockResolvedValue(4 as any)
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    const out = await insService.setIns(42, VALID_INS_M, 9, "DOCTOR", ctx)
    expect(out.updated).toBe(true)
  })

  // H5 round 2 — setByRole audit metadata
  it("H5 — VIEWER auto-onboarding logue setByRole=VIEWER (identitovigilance)", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    await insService.setIns(42, VALID_INS_M, 9, "VIEWER", ctx)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.setByRole).toBe("VIEWER")
  })
})

// ────────────────────────────────────────────────────────────────
// insService.getIns
// ────────────────────────────────────────────────────────────────

describe("insService.getIns", () => {
  it("dechiffre INS + audit READ + qualityStatus + setAt", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const realCipher = encryptField(VALID_INS_M)
    const setAt = new Date("2026-05-17T10:00:00Z")
    prismaMock.user.findUnique.mockResolvedValue({
      id: 42, ins: realCipher,
      insQualityStatus: "saisi_non_verifie",
      insSetAt: setAt,
    } as any)
    const out = await insService.getIns(42, 9, ctx, { patientId: 7 })
    expect(out.ins).toBe(VALID_INS_M)
    expect(out.hasIns).toBe(true)
    expect(out.qualityStatus).toBe("saisi_non_verifie")
    expect(out.setAt).toBe(setAt)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("READ")
    expect(audit.metadata.kind).toBe("user.ins.read")
    expect(audit.metadata.qualityStatus).toBe("saisi_non_verifie")
    expect(audit.metadata.patientId).toBe(7)
  })

  it("retourne hasIns:false + qualityStatus:null si User sans INS", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 42, ins: null, insQualityStatus: null, insSetAt: null,
    } as any)
    const out = await insService.getIns(42, 9, ctx)
    expect(out.ins).toBe(null)
    expect(out.hasIns).toBe(false)
    expect(out.qualityStatus).toBe(null)
  })

  it("404 si User introuvable", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)
    await expect(
      insService.getIns(999, 9, ctx),
    ).rejects.toBeInstanceOf(InsNotFoundError)
  })

  it("ins:null silent si decrypt fail (ciphertext corrompu)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 42, ins: "definitely-not-a-valid-ciphertext",
      insQualityStatus: "saisi_non_verifie", insSetAt: new Date(),
    } as any)
    const out = await insService.getIns(42, 9, ctx)
    expect(out.ins).toBe(null)
    expect(out.hasIns).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────
// insService.clearIns
// ────────────────────────────────────────────────────────────────

describe("insService.clearIns", () => {
  it("clear all INS cols + audit", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ insHmac: "prev-hmac" } as any)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    const out = await insService.clearIns(42, 9, ctx)
    expect(out.cleared).toBe(true)
    expect(out.alreadyCleared).toBe(false)
    const upd = prismaMock.user.updateMany.mock.calls[0]![0]!.data as any
    expect(upd.ins).toBe(null)
    expect(upd.insHmac).toBe(null)
    expect(upd.insQualityStatus).toBe(null)
    expect(upd.insSetAt).toBe(null)
    expect(upd.insSetByUserId).toBe(null)
    expect(upd.insTraitsHash).toBe(null)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.kind).toBe("user.ins.cleared")
    expect(audit.metadata.previousInsHmac).toBe("prev-hmac")
  })

  it("idempotent : clear deja vide = alreadyCleared", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ insHmac: null } as any)
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 } as any)
    const out = await insService.clearIns(42, 9, ctx)
    expect(out.alreadyCleared).toBe(true)
    const audits = prismaMock.auditLog.create.mock.calls.filter((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === "user.ins.cleared"
    })
    expect(audits).toHaveLength(0)
  })

  it("reason user_deletion (RGPD Art. 17 cascade)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ insHmac: "x" } as any)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    await insService.clearIns(42, 9, ctx, { reason: "user_deletion" })
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.reason).toBe("user_deletion")
  })

  // LOW round 2 — reattribution INS apres clearIns
  it("LOW round 2 — re-set du meme INS sur le MEME user post-clear → OK", async () => {
    // Clear (succes).
    prismaMock.user.findUnique.mockResolvedValueOnce({ insHmac: "old-hmac" } as any)
    prismaMock.user.updateMany.mockResolvedValueOnce({ count: 1 } as any)
    await insService.clearIns(42, 9, ctx)
    // Set memo INS sur meme user.
    prismaMock.user.findFirst.mockResolvedValueOnce(null) // pas de collision (l'INS n'est plus en DB)
    prismaMock.user.findUnique.mockResolvedValueOnce({ ...TRAITS_USER } as any)
    prismaMock.user.updateMany.mockResolvedValueOnce({ count: 1 } as any)
    const out = await insService.setIns(42, VALID_INS_M, 9, "DOCTOR", ctx)
    expect(out.updated).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────
// canBeSharedExternally guard (C1 round 2)
// ────────────────────────────────────────────────────────────────

describe("insService.canBeSharedExternally", () => {
  it("V1 saisi_non_verifie → false (interdit Réf. INS ANS §5.1)", () => {
    expect(insService.canBeSharedExternally("saisi_non_verifie")).toBe(false)
  })

  it("V2 insi_recupere → true", () => {
    expect(insService.canBeSharedExternally("insi_recupere")).toBe(true)
  })

  it("V2 insi_verifie → true", () => {
    expect(insService.canBeSharedExternally("insi_verifie")).toBe(true)
  })

  it("rejete_traits_incoherent → false", () => {
    expect(insService.canBeSharedExternally("rejete_traits_incoherent")).toBe(false)
  })

  it("null (pas d'INS) → false", () => {
    expect(insService.canBeSharedExternally(null)).toBe(false)
  })
})
