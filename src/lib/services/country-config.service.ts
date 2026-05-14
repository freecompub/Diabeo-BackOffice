/**
 * @module country-config.service
 * @description Groupe 8 i18n/Interop Batch 1 — 3 US, 3 SP.
 *
 *  - US-2113 currency configuration (ISO 4217 ; EUR / DZD)
 *  - US-2114 tax rules per country (FR TVA 20% / DZ TVA 19%, date-bounded)
 *  - US-2116 healthcare regulation references (HDS, RGPD, RPPS, ADELI, ...)
 *
 * All three are reference/configuration data — no PHI. ADMIN holds CRUD,
 * DOCTOR/NURSE only read. Audit log is emitted on every mutation through
 * `auditService.logWithTx` (US-2268 pivot for resourceId).
 *
 * Country codes are validated against ISO 3166-1 alpha-2 ; currency codes
 * against ISO 4217. Validation duplicated at DB layer via CHECK constraints
 * for defense in depth.
 */

import { Prisma } from "@prisma/client"
import { prisma, type PrismaClientOrTx as Tx } from "@/lib/db/client"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"
import { NotFoundError, ValidationError } from "./team-workflow.errors"

const ISO_3166_RE = /^[A-Z]{2}$/
const ISO_4217_RE = /^[A-Z]{3}$/
export const TAX_TYPES = [
  "VAT", "INCOME_TAX", "CORPORATE_TAX", "SOCIAL_CONTRIBUTION",
] as const
export type TaxType = (typeof TAX_TYPES)[number]
export const REG_TYPES = [
  "RPPS", "ADELI", "INS", "HDS", "RGPD", "MSSANTE", "FINESS", "OTHER",
] as const
export type RegulationType = (typeof REG_TYPES)[number]

// ─────────────────────────────────────────────────────────────
// US-2113 — Country currencies
// ─────────────────────────────────────────────────────────────

export type CurrencyDTO = {
  id: number
  countryCode: string
  currencyCode: string
  symbol: string
  exchangeRate: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

function toCurrencyDTO(r: {
  id: number; countryCode: string; currencyCode: string; symbol: string;
  exchangeRate: Prisma.Decimal; isActive: boolean;
  createdAt: Date; updatedAt: Date;
}): CurrencyDTO {
  return {
    id: r.id, countryCode: r.countryCode, currencyCode: r.currencyCode,
    symbol: r.symbol,
    exchangeRate: r.exchangeRate.toNumber(),
    isActive: r.isActive,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  }
}

export type CurrencyCreateInput = {
  countryCode: string
  currencyCode: string
  symbol: string
  exchangeRate: number
}
export type CurrencyUpdateInput = {
  symbol?: string
  exchangeRate?: number
  isActive?: boolean
}

// M11 — Named field validators. Each enforces a single rule and throws a
// typed ValidationError. Composition at the call site is explicit so a
// missing check is visible at code-review time.
function validateCountryCode(code: string): void {
  if (!ISO_3166_RE.test(code)) throw new ValidationError("countryCode")
}
function validateCurrencyCode(code: string): void {
  if (!ISO_4217_RE.test(code)) throw new ValidationError("currencyCode")
}
function validateExchangeRate(rate: number): void {
  if (rate <= 0 || !Number.isFinite(rate)) throw new ValidationError("exchangeRate")
}
function validateTaxType(t: string): void {
  if (!TAX_TYPES.includes(t as TaxType)) throw new ValidationError("taxType")
}
function validateBaseRate(rate: number): void {
  if (rate < 0 || rate > 1 || !Number.isFinite(rate)) throw new ValidationError("baseRate")
}
function validateRegulationType(t: string): void {
  if (!REG_TYPES.includes(t as RegulationType)) throw new ValidationError("regulationType")
}

export const countryCurrencyService = {
  async list(filter?: { countryCode?: string; isActive?: boolean }): Promise<CurrencyDTO[]> {
    if (filter?.countryCode) validateCountryCode(filter.countryCode)
    const rows = await prisma.countryCurrency.findMany({
      where: {
        ...(filter?.countryCode && { countryCode: filter.countryCode }),
        ...(filter?.isActive !== undefined && { isActive: filter.isActive }),
      },
      orderBy: [{ countryCode: "asc" }, { currencyCode: "asc" }],
      take: 200,
    })
    return rows.map(toCurrencyDTO)
  },

  async create(
    input: CurrencyCreateInput, auditUserId: number, ctx?: AuditContext,
  ): Promise<CurrencyDTO> {
    validateCountryCode(input.countryCode)
    validateCurrencyCode(input.currencyCode)
    validateExchangeRate(input.exchangeRate)
    if (!input.symbol || input.symbol.length > 8) throw new ValidationError("symbol")

    return prisma.$transaction(async (tx: Tx) => {
      try {
        const created = await tx.countryCurrency.create({
          data: {
            countryCode: input.countryCode,
            currencyCode: input.currencyCode,
            symbol: input.symbol,
            exchangeRate: new Prisma.Decimal(input.exchangeRate),
            createdBy: auditUserId,
          },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId, action: "CREATE", resource: "COUNTRY_CURRENCY",
          resourceId: String(created.id),
          ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
          metadata: { countryCode: input.countryCode, currencyCode: input.currencyCode },
        })
        return toCurrencyDTO(created)
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          throw new ValidationError("alreadyExists")
        }
        throw err
      }
    })
  },

  async update(
    id: number, input: CurrencyUpdateInput, auditUserId: number, ctx?: AuditContext,
  ): Promise<CurrencyDTO> {
    if (input.symbol !== undefined && (!input.symbol || input.symbol.length > 8)) {
      throw new ValidationError("symbol")
    }
    if (input.exchangeRate !== undefined) validateExchangeRate(input.exchangeRate)
    return prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.countryCurrency.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      const data: Prisma.CountryCurrencyUpdateInput = {}
      if (input.symbol !== undefined) data.symbol = input.symbol
      if (input.exchangeRate !== undefined) {
        data.exchangeRate = new Prisma.Decimal(input.exchangeRate)
      }
      if (input.isActive !== undefined) data.isActive = input.isActive
      const updated = await tx.countryCurrency.update({ where: { id }, data })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "COUNTRY_CURRENCY",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          countryCode: existing.countryCode, currencyCode: existing.currencyCode,
          updatedFields: Object.keys(input).filter((k) => input[k as keyof CurrencyUpdateInput] !== undefined),
        },
      })
      return toCurrencyDTO(updated)
    })
  },

  async deleteById(id: number, auditUserId: number, ctx?: AuditContext): Promise<{ deleted: true }> {
    return prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.countryCurrency.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      await tx.countryCurrency.delete({ where: { id } })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "COUNTRY_CURRENCY",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { countryCode: existing.countryCode, currencyCode: existing.currencyCode },
      })
      return { deleted: true as const }
    })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2114 — Country tax rules
// ─────────────────────────────────────────────────────────────

export type TaxRuleDTO = {
  id: number
  countryCode: string
  taxType: TaxType
  baseRate: number
  description: string | null
  appliesFrom: Date
  appliesUntil: Date | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

function toTaxRuleDTO(r: {
  id: number; countryCode: string; taxType: string;
  baseRate: Prisma.Decimal; description: string | null;
  appliesFrom: Date; appliesUntil: Date | null;
  isActive: boolean; createdAt: Date; updatedAt: Date;
}): TaxRuleDTO {
  return {
    id: r.id, countryCode: r.countryCode,
    // taxType is validated against TAX_TYPES at write-time + DB CHECK constraint,
    // so a stored value outside the enum is impossible (defense in depth).
    taxType: r.taxType as TaxType,
    baseRate: r.baseRate.toNumber(),
    description: r.description,
    appliesFrom: r.appliesFrom, appliesUntil: r.appliesUntil,
    isActive: r.isActive,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  }
}

export type TaxRuleCreateInput = {
  countryCode: string
  taxType: TaxType
  baseRate: number  // 0..1 (e.g. 0.20 for 20%)
  description?: string
  appliesFrom: Date
  appliesUntil?: Date | null
}
export type TaxRuleUpdateInput = {
  baseRate?: number
  description?: string | null
  appliesUntil?: Date | null
  isActive?: boolean
}

function validateDateRange(from: Date, until: Date | null | undefined): void {
  if (until !== null && until !== undefined && until <= from) {
    throw new ValidationError("dateRange")
  }
}

export const countryTaxRuleService = {
  async list(filter?: {
    countryCode?: string; taxType?: TaxType; isActive?: boolean;
  }): Promise<TaxRuleDTO[]> {
    if (filter?.countryCode) validateCountryCode(filter.countryCode)
    if (filter?.taxType) validateTaxType(filter.taxType)
    const rows = await prisma.countryTaxRule.findMany({
      where: {
        ...(filter?.countryCode && { countryCode: filter.countryCode }),
        ...(filter?.taxType && { taxType: filter.taxType }),
        ...(filter?.isActive !== undefined && { isActive: filter.isActive }),
      },
      orderBy: [{ countryCode: "asc" }, { taxType: "asc" }, { appliesFrom: "desc" }],
      take: 500,
    })
    return rows.map(toTaxRuleDTO)
  },

  async create(input: TaxRuleCreateInput, auditUserId: number, ctx?: AuditContext): Promise<TaxRuleDTO> {
    validateCountryCode(input.countryCode)
    validateTaxType(input.taxType)
    validateBaseRate(input.baseRate)
    validateDateRange(input.appliesFrom, input.appliesUntil ?? null)
    // L1 — reject whitespace-only descriptions (treat as empty).
    if (input.description !== undefined && (input.description.length > 500 || (input.description.length > 0 && !input.description.trim()))) {
      throw new ValidationError("description")
    }
    return prisma.$transaction(async (tx: Tx) => {
      // M4 — reject overlapping active periods for same (countryCode, taxType).
      // Two rules with overlapping ranges create ambiguous "current rate"
      // lookups. The UNIQUE constraint only catches identical `appliesFrom`.
      const conflict = await tx.countryTaxRule.findFirst({
        where: {
          countryCode: input.countryCode,
          taxType: input.taxType,
          isActive: true,
          appliesFrom: { lt: input.appliesUntil ?? new Date("9999-12-31") },
          OR: [
            { appliesUntil: null },
            { appliesUntil: { gt: input.appliesFrom } },
          ],
        },
        select: { id: true },
      })
      if (conflict) throw new ValidationError("overlappingPeriod")

      try {
        const created = await tx.countryTaxRule.create({
          data: {
            countryCode: input.countryCode,
            taxType: input.taxType,
            baseRate: new Prisma.Decimal(input.baseRate),
            description: input.description ?? null,
            appliesFrom: input.appliesFrom,
            appliesUntil: input.appliesUntil ?? null,
            createdBy: auditUserId,
          },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId, action: "CREATE", resource: "COUNTRY_TAX_RULE",
          resourceId: String(created.id),
          ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
          metadata: {
            countryCode: input.countryCode, taxType: input.taxType,
            appliesFrom: input.appliesFrom.toISOString().slice(0, 10),
          },
        })
        return toTaxRuleDTO(created)
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          throw new ValidationError("alreadyExists")
        }
        throw err
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async update(
    id: number, input: TaxRuleUpdateInput, auditUserId: number, ctx?: AuditContext,
  ): Promise<TaxRuleDTO> {
    if (input.baseRate !== undefined) validateBaseRate(input.baseRate)
    if (input.description !== undefined && input.description !== null && input.description.length > 500) {
      throw new ValidationError("description")
    }
    return prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.countryTaxRule.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      if (input.appliesUntil !== undefined && input.appliesUntil !== null && input.appliesUntil <= existing.appliesFrom) {
        throw new ValidationError("dateRange")
      }
      const data: Prisma.CountryTaxRuleUpdateInput = {}
      if (input.baseRate !== undefined) data.baseRate = new Prisma.Decimal(input.baseRate)
      if (input.description !== undefined) data.description = input.description
      if (input.appliesUntil !== undefined) data.appliesUntil = input.appliesUntil
      if (input.isActive !== undefined) data.isActive = input.isActive
      const updated = await tx.countryTaxRule.update({ where: { id }, data })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "COUNTRY_TAX_RULE",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          countryCode: existing.countryCode, taxType: existing.taxType,
          updatedFields: Object.keys(input).filter((k) => input[k as keyof TaxRuleUpdateInput] !== undefined),
        },
      })
      return toTaxRuleDTO(updated)
    })
  },

  async deleteById(id: number, auditUserId: number, ctx?: AuditContext): Promise<{ deleted: true }> {
    return prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.countryTaxRule.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      await tx.countryTaxRule.delete({ where: { id } })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "COUNTRY_TAX_RULE",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { countryCode: existing.countryCode, taxType: existing.taxType },
      })
      return { deleted: true as const }
    })
  },
}

// ─────────────────────────────────────────────────────────────
// US-2116 — Healthcare regulations
// ─────────────────────────────────────────────────────────────

export type RegulationDTO = {
  id: number
  countryCode: string
  regulationType: RegulationType
  title: string
  rule: string
  references: string | null
  enforcedFrom: Date
  enforcedUntil: Date | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

function toRegulationDTO(r: {
  id: number; countryCode: string; regulationType: string;
  title: string; rule: string; references: string | null;
  enforcedFrom: Date; enforcedUntil: Date | null;
  isActive: boolean; createdAt: Date; updatedAt: Date;
}): RegulationDTO {
  return {
    id: r.id, countryCode: r.countryCode,
    regulationType: r.regulationType as RegulationType,
    title: r.title, rule: r.rule, references: r.references,
    enforcedFrom: r.enforcedFrom, enforcedUntil: r.enforcedUntil,
    isActive: r.isActive,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  }
}

export type RegulationCreateInput = {
  countryCode: string
  regulationType: RegulationType
  title: string
  rule: string
  references?: string
  enforcedFrom: Date
  enforcedUntil?: Date | null
}
export type RegulationUpdateInput = {
  title?: string
  rule?: string
  references?: string | null
  enforcedUntil?: Date | null
  isActive?: boolean
}

function validateTitle(t: string): void {
  if (!t || !t.trim() || t.length > 200) throw new ValidationError("title")
}
function validateRule(r: string): void {
  if (!r || !r.trim() || r.length > 50_000) throw new ValidationError("rule")
}

export const healthcareRegulationService = {
  async list(filter?: {
    countryCode?: string; regulationType?: RegulationType; isActive?: boolean;
  }): Promise<RegulationDTO[]> {
    if (filter?.countryCode) validateCountryCode(filter.countryCode)
    if (filter?.regulationType) validateRegulationType(filter.regulationType)
    const rows = await prisma.healthcareRegulation.findMany({
      where: {
        ...(filter?.countryCode && { countryCode: filter.countryCode }),
        ...(filter?.regulationType && { regulationType: filter.regulationType }),
        ...(filter?.isActive !== undefined && { isActive: filter.isActive }),
      },
      orderBy: [{ countryCode: "asc" }, { regulationType: "asc" }, { enforcedFrom: "desc" }],
      take: 500,
    })
    return rows.map(toRegulationDTO)
  },

  async create(input: RegulationCreateInput, auditUserId: number, ctx?: AuditContext): Promise<RegulationDTO> {
    validateCountryCode(input.countryCode)
    validateRegulationType(input.regulationType)
    validateTitle(input.title)
    validateRule(input.rule)
    // L1 — reject whitespace-only references.
    if (input.references !== undefined && (input.references.length > 10_000 || (input.references.length > 0 && !input.references.trim()))) {
      throw new ValidationError("references")
    }
    validateDateRange(input.enforcedFrom, input.enforcedUntil ?? null)
    return prisma.$transaction(async (tx: Tx) => {
      // M5 — reject overlapping active periods for same (countryCode, regulationType).
      const conflict = await tx.healthcareRegulation.findFirst({
        where: {
          countryCode: input.countryCode,
          regulationType: input.regulationType,
          isActive: true,
          enforcedFrom: { lt: input.enforcedUntil ?? new Date("9999-12-31") },
          OR: [
            { enforcedUntil: null },
            { enforcedUntil: { gt: input.enforcedFrom } },
          ],
        },
        select: { id: true },
      })
      if (conflict) throw new ValidationError("overlappingPeriod")

      const created = await tx.healthcareRegulation.create({
        data: {
          countryCode: input.countryCode,
          regulationType: input.regulationType,
          title: input.title,
          rule: input.rule,
          references: input.references ?? null,
          enforcedFrom: input.enforcedFrom,
          enforcedUntil: input.enforcedUntil ?? null,
          createdBy: auditUserId,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "HEALTHCARE_REGULATION",
        resourceId: String(created.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { countryCode: input.countryCode, regulationType: input.regulationType },
      })
      return toRegulationDTO(created)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  },

  async update(
    id: number, input: RegulationUpdateInput, auditUserId: number, ctx?: AuditContext,
  ): Promise<RegulationDTO> {
    if (input.title !== undefined) validateTitle(input.title)
    if (input.rule !== undefined) validateRule(input.rule)
    if (input.references !== undefined && input.references !== null && input.references.length > 10_000) {
      throw new ValidationError("references")
    }
    return prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.healthcareRegulation.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      if (input.enforcedUntil !== undefined && input.enforcedUntil !== null && input.enforcedUntil <= existing.enforcedFrom) {
        throw new ValidationError("dateRange")
      }
      const data: Prisma.HealthcareRegulationUpdateInput = {}
      if (input.title !== undefined) data.title = input.title
      if (input.rule !== undefined) data.rule = input.rule
      if (input.references !== undefined) data.references = input.references
      if (input.enforcedUntil !== undefined) data.enforcedUntil = input.enforcedUntil
      if (input.isActive !== undefined) data.isActive = input.isActive
      const updated = await tx.healthcareRegulation.update({ where: { id }, data })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "HEALTHCARE_REGULATION",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          countryCode: existing.countryCode, regulationType: existing.regulationType,
          updatedFields: Object.keys(input).filter((k) => input[k as keyof RegulationUpdateInput] !== undefined),
        },
      })
      return toRegulationDTO(updated)
    })
  },

  async deleteById(id: number, auditUserId: number, ctx?: AuditContext): Promise<{ deleted: true }> {
    return prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.healthcareRegulation.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      await tx.healthcareRegulation.delete({ where: { id } })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "HEALTHCARE_REGULATION",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { countryCode: existing.countryCode, regulationType: existing.regulationType },
      })
      return { deleted: true as const }
    })
  },
}
