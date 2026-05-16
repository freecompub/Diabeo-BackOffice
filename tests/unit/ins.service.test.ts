/**
 * @description US-2026 — INS (Identite Nationale Sante) unit tests.
 *
 * Couvre :
 *   - validation Luhn-97 (cas valides + invalides + edge)
 *   - normalisation espaces / format
 *   - encrypt round-trip + HMAC stable
 *   - service set/get/clear (audit, collision, idempotence)
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import {
  insService,
  isValidInsFormat,
  normalizeIns,
  InsValidationError,
  InsCollisionError,
  InsNotFoundError,
} from "@/lib/services/ins.service"

const ctx = {
  ipAddress: "1.2.3.4",
  userAgent: "Chrome",
  requestId: "req-ins-1",
}

// Fixtures INS valides (calcul Luhn-97 effectue) :
//   1900175001001 + cle (96) = 190017500100196  -> H, ne en 1990, jan, 75001
//   2900175001001 + cle (46) = 290017500100146  -> F, ne en 1990, jan, 75001
const VALID_INS_M = "190017500100196"
const VALID_INS_F = "290017500100146"
const INVALID_INS_LUHN = "290017500100199" // cle fausse

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

// ────────────────────────────────────────────────────────────────
// Helpers purs : isValidInsFormat + normalizeIns
// ────────────────────────────────────────────────────────────────

describe("isValidInsFormat", () => {
  it("accepte INS valide H 15 chiffres avec cle Luhn-97 correcte", () => {
    expect(isValidInsFormat(VALID_INS_M)).toBe(true)
  })

  it("accepte INS valide F (cle distincte)", () => {
    expect(isValidInsFormat(VALID_INS_F)).toBe(true)
  })

  it("rejette INS de longueur != 15", () => {
    expect(isValidInsFormat("12345")).toBe(false)
    expect(isValidInsFormat("1234567890123456")).toBe(false)
  })

  it("rejette INS contenant des non-digits", () => {
    expect(isValidInsFormat("19001A500100196")).toBe(false)
    expect(isValidInsFormat("1 90017500100196")).toBe(false) // espace = rejette
  })

  it("rejette INS avec cle Luhn-97 incorrecte", () => {
    expect(isValidInsFormat(INVALID_INS_LUHN)).toBe(false)
  })

  it("rejette payloads non-string (defense type guard)", () => {
    expect(isValidInsFormat(undefined as any)).toBe(false)
    expect(isValidInsFormat(null as any)).toBe(false)
    expect(isValidInsFormat(123 as any)).toBe(false)
  })
})

describe("normalizeIns", () => {
  it("retire espaces internes", () => {
    expect(normalizeIns("1 90 01 75 00 100 196")).toBe(VALID_INS_M)
  })

  it("retire whitespace alentour", () => {
    expect(normalizeIns("  190017500100196  ")).toBe(VALID_INS_M)
  })

  it("preserve digits sans espace", () => {
    expect(normalizeIns(VALID_INS_M)).toBe(VALID_INS_M)
  })
})

// ────────────────────────────────────────────────────────────────
// insService.setIns
// ────────────────────────────────────────────────────────────────

describe("insService.setIns", () => {
  it("rejette format invalide (longueur)", async () => {
    await expect(
      insService.setIns(42, "12345", 9, ctx),
    ).rejects.toBeInstanceOf(InsValidationError)
  })

  it("rejette cle Luhn-97 incorrecte", async () => {
    await expect(
      insService.setIns(42, INVALID_INS_LUHN, 9, ctx),
    ).rejects.toBeInstanceOf(InsValidationError)
  })

  it("normalise espaces puis valide", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null) // pas de collision
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    const out = await insService.setIns(42, "1 90017500 100196", 9, ctx)
    expect(out.updated).toBe(true)
    // updateMany doit recevoir ciphertext base64 + hmac hex 64 chars.
    const upd = prismaMock.user.updateMany.mock.calls[0]![0]!.data as any
    expect(upd.ins).toBeTruthy()
    expect(upd.ins).not.toContain("190017500100196") // chiffre
    expect(upd.insHmac).toMatch(/^[0-9a-f]{64}$/)
  })

  it("rejette collision : INS deja registered pour un autre User", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 99 } as any)
    await expect(
      insService.setIns(42, VALID_INS_M, 9, ctx),
    ).rejects.toBeInstanceOf(InsCollisionError)
    // Audit collision emis (UNAUTHORIZED + kind user.ins.collision).
    const collisionAudit = prismaMock.auditLog.create.mock.calls.find((c) => {
      const d = c[0].data as any
      return d.action === "UNAUTHORIZED" && d.metadata?.kind === "user.ins.collision"
    })
    expect(collisionAudit).toBeDefined()
  })

  it("404 si User cible introuvable (updateMany count=0)", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 } as any)
    await expect(
      insService.setIns(999, VALID_INS_M, 9, ctx),
    ).rejects.toBeInstanceOf(InsNotFoundError)
  })

  it("audit kind=user.ins.set + pivot patientId (US-2268)", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    await insService.setIns(42, VALID_INS_M, 9, ctx, { patientId: 7 })
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.kind).toBe("user.ins.set")
    expect(audit.metadata.patientId).toBe(7)
    expect(audit.action).toBe("UPDATE")
    expect(audit.resource).toBe("USER_INS")
    expect(audit.resourceId).toBe("42") // User.id natif
  })

  it("HMAC deterministe : 2 setIns avec meme INS produisent meme insHmac", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    await insService.setIns(42, VALID_INS_M, 9, ctx)
    const h1 = (prismaMock.user.updateMany.mock.calls[0]![0]!.data as any).insHmac
    prismaMock.user.findFirst.mockResolvedValue(null)
    await insService.setIns(43, VALID_INS_M, 9, ctx)
    const h2 = (prismaMock.user.updateMany.mock.calls[1]![0]!.data as any).insHmac
    expect(h1).toBe(h2)
  })

  it("HMAC distinct pour 2 INS differents", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    await insService.setIns(42, VALID_INS_M, 9, ctx)
    const hM = (prismaMock.user.updateMany.mock.calls[0]![0]!.data as any).insHmac
    await insService.setIns(43, VALID_INS_F, 9, ctx)
    const hF = (prismaMock.user.updateMany.mock.calls[1]![0]!.data as any).insHmac
    expect(hM).not.toBe(hF)
  })

  it("Ciphertext non-deterministe (IV random) : 2 chiffrements distincts", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null)
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    await insService.setIns(42, VALID_INS_M, 9, ctx)
    const c1 = (prismaMock.user.updateMany.mock.calls[0]![0]!.data as any).ins
    await insService.setIns(43, VALID_INS_M, 9, ctx)
    const c2 = (prismaMock.user.updateMany.mock.calls[1]![0]!.data as any).ins
    expect(c1).not.toBe(c2) // IV aleatoire → ciphertext differe
  })
})

// ────────────────────────────────────────────────────────────────
// insService.getIns — encrypt roundtrip + audit READ
// ────────────────────────────────────────────────────────────────

describe("insService.getIns", () => {
  it("dechiffre INS et logue READ + hasIns true", async () => {
    const { encryptField } = await import("@/lib/crypto/fields")
    const realCipher = encryptField(VALID_INS_M)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 42, ins: realCipher,
    } as any)
    const out = await insService.getIns(42, 9, ctx, { patientId: 7 })
    expect(out.ins).toBe(VALID_INS_M)
    expect(out.hasIns).toBe(true)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("READ")
    expect(audit.metadata.kind).toBe("user.ins.read")
    expect(audit.metadata.hasIns).toBe(true)
    expect(audit.metadata.patientId).toBe(7)
  })

  it("retourne ins:null + hasIns:false si User sans INS", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 42, ins: null,
    } as any)
    const out = await insService.getIns(42, 9, ctx)
    expect(out.ins).toBe(null)
    expect(out.hasIns).toBe(false)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.hasIns).toBe(false)
  })

  it("404 si User introuvable", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)
    await expect(
      insService.getIns(999, 9, ctx),
    ).rejects.toBeInstanceOf(InsNotFoundError)
  })

  it("retourne ins:null si decrypt fail (ciphertext corrompu) — pas de throw", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 42, ins: "definitely-not-a-valid-ciphertext",
    } as any)
    const out = await insService.getIns(42, 9, ctx)
    expect(out.ins).toBe(null)
    expect(out.hasIns).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────
// insService.clearIns — idempotence + audit
// ────────────────────────────────────────────────────────────────

describe("insService.clearIns", () => {
  it("clear INS et logue UPDATE kind=user.ins.cleared", async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    const out = await insService.clearIns(42, 9, ctx)
    expect(out.cleared).toBe(true)
    expect(out.alreadyCleared).toBe(false)
    // Verifie que ins ET insHmac sont mis a null.
    const upd = prismaMock.user.updateMany.mock.calls[0]![0]!.data as any
    expect(upd.ins).toBe(null)
    expect(upd.insHmac).toBe(null)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.kind).toBe("user.ins.cleared")
  })

  it("idempotent : clear deja vide = alreadyCleared=true sans audit row", async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 } as any)
    const out = await insService.clearIns(42, 9, ctx)
    expect(out.alreadyCleared).toBe(true)
    // Pas d'audit emis pour no-op (evite spam si retry).
    const audits = prismaMock.auditLog.create.mock.calls.filter((c) => {
      const d = c[0].data as any
      return d.metadata?.kind === "user.ins.cleared"
    })
    expect(audits).toHaveLength(0)
  })

  it("reason 'user_deletion' propage dans metadata (cascade RGPD Art. 17)", async () => {
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 } as any)
    await insService.clearIns(42, 9, ctx, { reason: "user_deletion" })
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.reason).toBe("user_deletion")
  })
})
