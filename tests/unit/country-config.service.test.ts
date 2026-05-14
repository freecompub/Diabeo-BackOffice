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
