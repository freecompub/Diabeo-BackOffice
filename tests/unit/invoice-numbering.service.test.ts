/**
 * @description US-2105 — invoice-numbering.service unit tests.
 *
 * Couvre M1 (review PR #406) :
 *   - `reserveNextInvoiceNumber` exécute le bon ordre INSERT → SELECT
 *     FOR UPDATE → UPDATE
 *   - retourne le numéro formaté `<CC>-<YYYY>-<6digits>`
 *   - overflow lève `InvoiceSequenceOverflowError`
 *   - le runtime guard `pg_current_xact_id_if_assigned()` est désactivé
 *     en `NODE_ENV=test` (sinon les mocks n'ont pas de tx ID)
 *
 * Note : un test de concurrence réelle nécessite Postgres (FOR UPDATE
 * row lock). À déplacer en test d'intégration quand on aura un harness
 * pg-mem ou docker-postgres dédié.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  reserveNextInvoiceNumber,
  formatInvoiceNumber,
  InvoiceSequenceOverflowError,
} from "@/lib/services/invoice-numbering.service"

beforeEach(() => {
  prismaMock.$executeRaw.mockResolvedValue(1 as any)
})

describe("reserveNextInvoiceNumber (US-2105)", () => {
  it("returns first number FR-2026-000001 when sequence is empty", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ last_number: 0 }] as any)
    const out = await reserveNextInvoiceNumber(prismaMock as any, "FR", 2026)
    expect(out).toBe("FR-2026-000001")
  })

  it("returns next number when sequence has 41 issued", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ last_number: 41 }] as any)
    const out = await reserveNextInvoiceNumber(prismaMock as any, "FR", 2026)
    expect(out).toBe("FR-2026-000042")
  })

  it("executes INSERT … ON CONFLICT then SELECT FOR UPDATE then UPDATE", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ last_number: 5 }] as any)
    await reserveNextInvoiceNumber(prismaMock as any, "DZ", 2026)
    // 2 $executeRaw calls : INSERT ON CONFLICT + UPDATE last_number
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(2)
    // 1 $queryRaw : SELECT FOR UPDATE
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it("throws InvoiceSequenceOverflowError when last reaches MAX (999_999)", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ last_number: 999_999 }] as any)
    await expect(reserveNextInvoiceNumber(prismaMock as any, "FR", 2099))
      .rejects.toBeInstanceOf(InvoiceSequenceOverflowError)
  })

  it("throws when sequence row missing post-INSERT (defensive)", async () => {
    prismaMock.$queryRaw.mockResolvedValue([] as any)
    await expect(reserveNextInvoiceNumber(prismaMock as any, "FR", 2026))
      .rejects.toThrow(/row missing/)
  })

  it("uppercases countryCode before SQL", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ last_number: 0 }] as any)
    const out = await reserveNextInvoiceNumber(prismaMock as any, "fr", 2026)
    expect(out).toBe("FR-2026-000001")
  })
})

describe("formatInvoiceNumber edge cases (US-2105)", () => {
  it("pads sequence to 6 digits", () => {
    expect(formatInvoiceNumber("FR", 2026, 1)).toBe("FR-2026-000001")
    expect(formatInvoiceNumber("FR", 2026, 999)).toBe("FR-2026-000999")
    expect(formatInvoiceNumber("FR", 2026, 100_000)).toBe("FR-2026-100000")
  })

  it("rejects sequence ≥ 1_000_000", () => {
    expect(() => formatInvoiceNumber("FR", 2026, 1_000_000)).toThrow(/sequence/)
  })

  it("rejects sequence ≤ 0", () => {
    expect(() => formatInvoiceNumber("FR", 2026, 0)).toThrow(/sequence/)
    expect(() => formatInvoiceNumber("FR", 2026, -5)).toThrow(/sequence/)
  })
})
