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
const TAX_TYPES = [
  "VAT", "INCOME_TAX", "CORPORATE_TAX", "SOCIAL_CONTRIBUTION",
] as const
type TaxType = (typeof TAX_TYPES)[number]
const REG_TYPES = [
  "RPPS", "ADELI", "INS", "HDS", "RGPD", "MSSANTE", "FINESS", "OTHER",
] as const
type RegulationType = (typeof REG_TYPES)[number]

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

function validateCurrencyInput(input: { countryCode?: string; currencyCode?: string; exchangeRate?: number }) {
  if (input.countryCode !== undefined && !ISO_3166_RE.test(input.countryCode)) {
    throw new ValidationError("countryCode")
  }
  if (input.currencyCode !== undefined && !ISO_4217_RE.test(input.currencyCode)) {
    throw new ValidationError("currencyCode")
  }
  if (input.exchangeRate !== undefined && (input.exchangeRate <= 0 || !Number.isFinite(input.exchangeRate))) {
    throw new ValidationError("exchangeRate")
  }
}

export const countryCurrencyService = {
  async list(filter?: { countryCode?: string; isActive?: boolean }): Promise<CurrencyDTO[]> {
    if (filter?.countryCode) validateCurrencyInput({ countryCode: filter.countryCode })
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
    validateCurrencyInput(input)
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
    if (input.exchangeRate !== undefined) {
      validateCurrencyInput({ exchangeRate: input.exchangeRate })
    }
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
  taxType: string
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
    id: r.id, countryCode: r.countryCode, taxType: r.taxType,
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

function validateTaxInput(input: { countryCode?: string; taxType?: string; baseRate?: number; appliesFrom?: Date; appliesUntil?: Date | null }) {
  if (input.countryCode !== undefined && !ISO_3166_RE.test(input.countryCode)) {
    throw new ValidationError("countryCode")
  }
  if (input.taxType !== undefined && !TAX_TYPES.includes(input.taxType as TaxType)) {
    throw new ValidationError("taxType")
  }
  if (
    input.baseRate !== undefined &&
    (input.baseRate < 0 || input.baseRate > 1 || !Number.isFinite(input.baseRate))
  ) {
    throw new ValidationError("baseRate")
  }
  if (
    input.appliesFrom !== undefined && input.appliesUntil !== undefined &&
    input.appliesUntil !== null && input.appliesUntil <= input.appliesFrom
  ) {
    throw new ValidationError("dateRange")
  }
}

export const countryTaxRuleService = {
  async list(filter?: {
    countryCode?: string; taxType?: TaxType; isActive?: boolean;
  }): Promise<TaxRuleDTO[]> {
    if (filter?.countryCode) validateTaxInput({ countryCode: filter.countryCode })
    if (filter?.taxType) validateTaxInput({ taxType: filter.taxType })
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
    validateTaxInput(input)
    if (input.description !== undefined && input.description.length > 500) {
      throw new ValidationError("description")
    }
    return prisma.$transaction(async (tx: Tx) => {
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
    })
  },

  async update(
    id: number, input: TaxRuleUpdateInput, auditUserId: number, ctx?: AuditContext,
  ): Promise<TaxRuleDTO> {
    if (input.baseRate !== undefined) validateTaxInput({ baseRate: input.baseRate })
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
  regulationType: string
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
    id: r.id, countryCode: r.countryCode, regulationType: r.regulationType,
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

function validateRegulationInput(input: { countryCode?: string; regulationType?: string; title?: string; rule?: string }) {
  if (input.countryCode !== undefined && !ISO_3166_RE.test(input.countryCode)) {
    throw new ValidationError("countryCode")
  }
  if (input.regulationType !== undefined && !REG_TYPES.includes(input.regulationType as RegulationType)) {
    throw new ValidationError("regulationType")
  }
  if (input.title !== undefined && (!input.title || input.title.length > 200)) {
    throw new ValidationError("title")
  }
  if (input.rule !== undefined && (!input.rule || input.rule.length > 50_000)) {
    throw new ValidationError("rule")
  }
}

export const healthcareRegulationService = {
  async list(filter?: {
    countryCode?: string; regulationType?: RegulationType; isActive?: boolean;
  }): Promise<RegulationDTO[]> {
    if (filter?.countryCode) validateRegulationInput({ countryCode: filter.countryCode })
    if (filter?.regulationType) validateRegulationInput({ regulationType: filter.regulationType })
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
    validateRegulationInput(input)
    if (input.references !== undefined && input.references.length > 10_000) {
      throw new ValidationError("references")
    }
    if (input.enforcedUntil && input.enforcedUntil <= input.enforcedFrom) {
      throw new ValidationError("dateRange")
    }
    return prisma.$transaction(async (tx: Tx) => {
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
    })
  },

  async update(
    id: number, input: RegulationUpdateInput, auditUserId: number, ctx?: AuditContext,
  ): Promise<RegulationDTO> {
    if (input.title !== undefined) validateRegulationInput({ title: input.title })
    if (input.rule !== undefined) validateRegulationInput({ rule: input.rule })
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
