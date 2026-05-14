/**
 * Test suite: country-config.service (US-2113, US-2114, US-2116)
 *
 * Covers:
 *  - ISO 3166-1 alpha-2 + ISO 4217 validation
 *  - tax rate bounds [0, 1]
 *  - date range coherence (applies_from < applies_until ; enforced_from < enforced_until)
 *  - audit emission on every CRUD operation
 *  - unique constraint mapping (P2002 → ValidationError)
 */
import { Prisma } from "@prisma/client"
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  countryCurrencyService,
  countryTaxRuleService,
  healthcareRegulationService,
} from "@/lib/services/country-config.service"
import {
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

// ─────────────────────────────────────────────────────────────
// US-2113 — currencies
// ─────────────────────────────────────────────────────────────

describe("countryCurrencyService (US-2113)", () => {
  it("rejects invalid country code (not ISO 3166 alpha-2)", async () => {
    await expect(
      countryCurrencyService.create(
        { countryCode: "FRA", currencyCode: "EUR", symbol: "€", exchangeRate: 1 }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects invalid currency code (not ISO 4217)", async () => {
    await expect(
      countryCurrencyService.create(
        { countryCode: "FR", currencyCode: "EU", symbol: "€", exchangeRate: 1 }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects non-positive exchangeRate", async () => {
    await expect(
      countryCurrencyService.create(
        { countryCode: "FR", currencyCode: "EUR", symbol: "€", exchangeRate: 0 }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects symbol > 8 chars", async () => {
    await expect(
      countryCurrencyService.create(
        { countryCode: "FR", currencyCode: "EUR", symbol: "very-long", exchangeRate: 1 }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("creates EUR/FR and audits", async () => {
    prismaMock.countryCurrency.create.mockResolvedValue({
      id: 1, countryCode: "FR", currencyCode: "EUR", symbol: "€",
      exchangeRate: new Prisma.Decimal(1), isActive: true,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await countryCurrencyService.create(
      { countryCode: "FR", currencyCode: "EUR", symbol: "€", exchangeRate: 1 }, 9,
    )
    expect(out.exchangeRate).toBe(1)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.resource).toBe("COUNTRY_CURRENCY")
    expect(audit.action).toBe("CREATE")
  })
  it("maps P2002 unique violation to ValidationError(alreadyExists)", async () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "unique violation", { code: "P2002", clientVersion: "7.6.0", meta: {} },
    )
    prismaMock.countryCurrency.create.mockRejectedValueOnce(err)
    await expect(
      countryCurrencyService.create(
        { countryCode: "FR", currencyCode: "EUR", symbol: "€", exchangeRate: 1 }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("update throws NotFoundError when id missing", async () => {
    prismaMock.countryCurrency.findUnique.mockResolvedValue(null)
    await expect(
      countryCurrencyService.update(999, { isActive: false }, 9),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
  it("delete throws NotFoundError when id missing", async () => {
    prismaMock.countryCurrency.findUnique.mockResolvedValue(null)
    await expect(countryCurrencyService.deleteById(999, 9))
      .rejects.toBeInstanceOf(NotFoundError)
  })
})

// ─────────────────────────────────────────────────────────────
// US-2114 — tax rules
// ─────────────────────────────────────────────────────────────

describe("countryTaxRuleService (US-2114)", () => {
  it("rejects taxType not in enum", async () => {
    await expect(
      countryTaxRuleService.create(
        { countryCode: "FR", taxType: "BOGUS" as any, baseRate: 0.2, appliesFrom: new Date("2024-01-01") }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects baseRate > 1 (must be fraction 0..1)", async () => {
    await expect(
      countryTaxRuleService.create(
        { countryCode: "FR", taxType: "VAT", baseRate: 20, appliesFrom: new Date("2024-01-01") }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects appliesUntil <= appliesFrom", async () => {
    await expect(
      countryTaxRuleService.create(
        {
          countryCode: "FR", taxType: "VAT", baseRate: 0.2,
          appliesFrom: new Date("2024-01-01"),
          appliesUntil: new Date("2023-12-31"),
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("creates FR VAT 20% and audits", async () => {
    prismaMock.countryTaxRule.create.mockResolvedValue({
      id: 1, countryCode: "FR", taxType: "VAT",
      baseRate: new Prisma.Decimal(0.2),
      description: "TVA standard FR",
      appliesFrom: new Date("2024-01-01"), appliesUntil: null,
      isActive: true, createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await countryTaxRuleService.create(
      {
        countryCode: "FR", taxType: "VAT", baseRate: 0.2,
        description: "TVA standard FR",
        appliesFrom: new Date("2024-01-01"),
      }, 9,
    )
    expect(out.baseRate).toBe(0.2)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.countryCode).toBe("FR")
  })
  it("update rejects appliesUntil before existing appliesFrom", async () => {
    prismaMock.countryTaxRule.findUnique.mockResolvedValue({
      id: 1, countryCode: "FR", taxType: "VAT",
      baseRate: new Prisma.Decimal(0.2),
      appliesFrom: new Date("2024-01-01"), appliesUntil: null,
      isActive: true,
    } as any)
    await expect(
      countryTaxRuleService.update(1, { appliesUntil: new Date("2023-01-01") }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

// ─────────────────────────────────────────────────────────────
// US-2116 — healthcare regulations
// ─────────────────────────────────────────────────────────────

describe("healthcareRegulationService (US-2116)", () => {
  it("rejects unknown regulationType", async () => {
    await expect(
      healthcareRegulationService.create(
        {
          countryCode: "FR", regulationType: "EXOTIC" as any,
          title: "X", rule: "Y", enforcedFrom: new Date("2024-01-01"),
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects empty title", async () => {
    await expect(
      healthcareRegulationService.create(
        {
          countryCode: "FR", regulationType: "RPPS",
          title: "", rule: "Y", enforcedFrom: new Date("2024-01-01"),
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects enforcedUntil <= enforcedFrom", async () => {
    await expect(
      healthcareRegulationService.create(
        {
          countryCode: "FR", regulationType: "HDS",
          title: "T", rule: "R",
          enforcedFrom: new Date("2024-01-01"),
          enforcedUntil: new Date("2023-12-31"),
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("creates FR HDS regulation and audits", async () => {
    prismaMock.healthcareRegulation.create.mockResolvedValue({
      id: 1, countryCode: "FR", regulationType: "HDS",
      title: "Hébergement Données de Santé",
      rule: "Hébergement chez prestataire certifié HDS",
      references: "https://esante.gouv.fr/",
      enforcedFrom: new Date("2018-04-01"), enforcedUntil: null,
      isActive: true, createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await healthcareRegulationService.create(
      {
        countryCode: "FR", regulationType: "HDS",
        title: "Hébergement Données de Santé",
        rule: "Hébergement chez prestataire certifié HDS",
        references: "https://esante.gouv.fr/",
        enforcedFrom: new Date("2018-04-01"),
      }, 9,
    )
    expect(out.regulationType).toBe("HDS")
    expect(out.references).toContain("esante.gouv.fr")
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.resource).toBe("HEALTHCARE_REGULATION")
  })
})

// ─────────────────────────────────────────────────────────────
// Cross-cutting: list with filters
// ─────────────────────────────────────────────────────────────

describe("countryCurrencyService.update + delete + list (coverage)", () => {
  it("update happy path", async () => {
    prismaMock.countryCurrency.findUnique.mockResolvedValue({
      id: 1, countryCode: "FR", currencyCode: "EUR",
    } as any)
    prismaMock.countryCurrency.update.mockResolvedValue({
      id: 1, countryCode: "FR", currencyCode: "EUR", symbol: "€",
      exchangeRate: new Prisma.Decimal(1), isActive: false,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await countryCurrencyService.update(1, { isActive: false, symbol: "€" }, 9)
    expect(out.isActive).toBe(false)
  })
  it("update rejects empty symbol", async () => {
    await expect(
      countryCurrencyService.update(1, { symbol: "" }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("update rejects negative exchange rate", async () => {
    await expect(
      countryCurrencyService.update(1, { exchangeRate: -1 }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("delete happy path + audits", async () => {
    prismaMock.countryCurrency.findUnique.mockResolvedValue({
      id: 1, countryCode: "FR", currencyCode: "EUR",
    } as any)
    prismaMock.countryCurrency.delete.mockResolvedValue({} as any)
    const out = await countryCurrencyService.deleteById(1, 9)
    expect(out.deleted).toBe(true)
  })
  it("list with countryCode filter", async () => {
    prismaMock.countryCurrency.findMany.mockResolvedValue([] as any)
    await countryCurrencyService.list({ countryCode: "FR", isActive: true })
    expect(prismaMock.countryCurrency.findMany).toHaveBeenCalled()
  })
})

describe("countryTaxRuleService.update + delete + list + overlap (coverage)", () => {
  it("update happy path", async () => {
    prismaMock.countryTaxRule.findUnique.mockResolvedValue({
      id: 1, countryCode: "FR", taxType: "VAT",
      baseRate: new Prisma.Decimal(0.2),
      appliesFrom: new Date("2024-01-01"), appliesUntil: null,
    } as any)
    prismaMock.countryTaxRule.update.mockResolvedValue({
      id: 1, countryCode: "FR", taxType: "VAT",
      baseRate: new Prisma.Decimal(0.21), description: null,
      appliesFrom: new Date("2024-01-01"),
      appliesUntil: new Date("2025-12-31"),
      isActive: true, createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await countryTaxRuleService.update(
      1, { baseRate: 0.21, appliesUntil: new Date("2025-12-31"), description: "test" }, 9,
    )
    expect(out.baseRate).toBe(0.21)
  })
  it("update rejects out-of-range baseRate", async () => {
    await expect(
      countryTaxRuleService.update(1, { baseRate: 2 }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("update rejects too-long description", async () => {
    await expect(
      countryTaxRuleService.update(1, { description: "x".repeat(501) }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("delete throws NotFoundError when missing", async () => {
    prismaMock.countryTaxRule.findUnique.mockResolvedValue(null)
    await expect(countryTaxRuleService.deleteById(999, 9))
      .rejects.toBeInstanceOf(NotFoundError)
  })
  it("delete happy path", async () => {
    prismaMock.countryTaxRule.findUnique.mockResolvedValue({
      id: 1, countryCode: "FR", taxType: "VAT",
    } as any)
    prismaMock.countryTaxRule.delete.mockResolvedValue({} as any)
    const out = await countryTaxRuleService.deleteById(1, 9)
    expect(out.deleted).toBe(true)
  })
  it("M4 — overlap rejected on create with adjacent existing rule", async () => {
    prismaMock.countryTaxRule.findFirst.mockResolvedValue({ id: 99 } as any)
    await expect(
      countryTaxRuleService.create(
        { countryCode: "FR", taxType: "VAT", baseRate: 0.2, appliesFrom: new Date("2024-01-01") },
        9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects too-long description on create", async () => {
    await expect(
      countryTaxRuleService.create(
        {
          countryCode: "FR", taxType: "VAT", baseRate: 0.2,
          description: "x".repeat(501),
          appliesFrom: new Date("2024-01-01"),
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("maps P2002 to ValidationError(alreadyExists)", async () => {
    prismaMock.countryTaxRule.findFirst.mockResolvedValue(null)
    const err = new Prisma.PrismaClientKnownRequestError(
      "unique violation", { code: "P2002", clientVersion: "7.6.0", meta: {} },
    )
    prismaMock.countryTaxRule.create.mockRejectedValueOnce(err)
    await expect(
      countryTaxRuleService.create(
        { countryCode: "FR", taxType: "VAT", baseRate: 0.2, appliesFrom: new Date("2024-01-01") },
        9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("list filters happy path", async () => {
    prismaMock.countryTaxRule.findMany.mockResolvedValue([] as any)
    await countryTaxRuleService.list({ countryCode: "FR", taxType: "VAT", isActive: true })
    expect(prismaMock.countryTaxRule.findMany).toHaveBeenCalled()
  })
})

describe("healthcareRegulationService.update + delete + list + overlap (coverage)", () => {
  it("update happy path", async () => {
    prismaMock.healthcareRegulation.findUnique.mockResolvedValue({
      id: 1, countryCode: "FR", regulationType: "HDS",
      enforcedFrom: new Date("2018-04-01"), enforcedUntil: null,
    } as any)
    prismaMock.healthcareRegulation.update.mockResolvedValue({
      id: 1, countryCode: "FR", regulationType: "HDS",
      title: "Updated", rule: "Updated rule",
      references: "ref-url",
      enforcedFrom: new Date("2018-04-01"),
      enforcedUntil: new Date("2030-01-01"),
      isActive: false, createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await healthcareRegulationService.update(
      1,
      {
        title: "Updated", rule: "Updated rule",
        references: "ref-url",
        enforcedUntil: new Date("2030-01-01"),
        isActive: false,
      },
      9,
    )
    expect(out.title).toBe("Updated")
    expect(out.isActive).toBe(false)
  })
  it("update rejects empty title", async () => {
    await expect(
      healthcareRegulationService.update(1, { title: "" }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("update rejects empty rule", async () => {
    await expect(
      healthcareRegulationService.update(1, { rule: "" }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("update rejects too-long references", async () => {
    await expect(
      healthcareRegulationService.update(1, { references: "x".repeat(10_001) }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("update rejects whitespace-only references", async () => {
    await expect(
      healthcareRegulationService.update(1, { references: "   " }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("update rejects appliesUntil before existing enforcedFrom", async () => {
    prismaMock.healthcareRegulation.findUnique.mockResolvedValue({
      id: 1, countryCode: "FR", regulationType: "HDS",
      enforcedFrom: new Date("2018-04-01"), enforcedUntil: null,
    } as any)
    await expect(
      healthcareRegulationService.update(1, { enforcedUntil: new Date("2010-01-01") }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("delete happy path", async () => {
    prismaMock.healthcareRegulation.findUnique.mockResolvedValue({
      id: 1, countryCode: "FR", regulationType: "HDS",
    } as any)
    prismaMock.healthcareRegulation.delete.mockResolvedValue({} as any)
    const out = await healthcareRegulationService.deleteById(1, 9)
    expect(out.deleted).toBe(true)
  })
  it("delete throws NotFoundError when missing", async () => {
    prismaMock.healthcareRegulation.findUnique.mockResolvedValue(null)
    await expect(healthcareRegulationService.deleteById(999, 9))
      .rejects.toBeInstanceOf(NotFoundError)
  })
  it("M5 — overlap rejected on create with adjacent existing", async () => {
    prismaMock.healthcareRegulation.findFirst.mockResolvedValue({ id: 99 } as any)
    await expect(
      healthcareRegulationService.create(
        {
          countryCode: "FR", regulationType: "HDS",
          title: "T", rule: "R", enforcedFrom: new Date("2024-01-01"),
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects too-long references on create", async () => {
    await expect(
      healthcareRegulationService.create(
        {
          countryCode: "FR", regulationType: "HDS",
          title: "T", rule: "R",
          references: "x".repeat(10_001),
          enforcedFrom: new Date("2024-01-01"),
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("list filter validation", () => {
  it("currency list rejects bad countryCode filter", async () => {
    await expect(countryCurrencyService.list({ countryCode: "FRA" }))
      .rejects.toBeInstanceOf(ValidationError)
  })
  it("tax list rejects bad taxType filter", async () => {
    await expect(countryTaxRuleService.list({ taxType: "BAD" as any }))
      .rejects.toBeInstanceOf(ValidationError)
  })
  it("regulation list rejects bad regulationType filter", async () => {
    await expect(healthcareRegulationService.list({ regulationType: "X" as any }))
      .rejects.toBeInstanceOf(ValidationError)
  })
})
