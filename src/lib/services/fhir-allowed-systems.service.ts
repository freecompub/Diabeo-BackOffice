/**
 * @module fhir-allowed-systems.service
 * @description Groupe 8 i18n/Interop Batch 1 — US-2123 H5 hardening.
 *
 * Manages the registry of approved external FHIR servers (RGPD Art. 28 /
 * HDS Art. 4 DPA enforcement). Pure ADMIN scope — no PHI in this table.
 *
 * Normalization: `origin` is lowercased + path-stripped at write-time so
 * the DB CHECK `^https://[a-z0-9.-]+(:\d+)?$` never trips on legitimate
 * mixed-case input. SSRF defense: rejects internal/loopback/RFC1918 hosts.
 */

import { Prisma } from "@prisma/client"
import { prisma, type PrismaClientOrTx as Tx } from "@/lib/db/client"
import { auditService, type AuditContext } from "./audit.service"
import { NotFoundError, ValidationError } from "./team-workflow.errors"

// M4 (re-review) — SSRF guard. Reject internal / metadata / RFC1918 hosts.
const FORBIDDEN_HOSTS_RE = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|::1|fe80:)/i
const PRIVATE_IPV4_RE = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/

function normalizeAndValidateOrigin(input: string): string {
  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    throw new ValidationError("origin")
  }
  if (parsed.protocol !== "https:") throw new ValidationError("originMustBeHttps")
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new ValidationError("originMustNotHavePath")
  }
  const host = parsed.hostname.toLowerCase()
  if (FORBIDDEN_HOSTS_RE.test(host) || PRIVATE_IPV4_RE.test(host) || host === "metadata.google.internal") {
    throw new ValidationError("forbiddenHost")
  }
  return parsed.origin // already lowercased by URL parser
}

export type FhirAllowedSystemDTO = {
  id: number
  origin: string
  label: string
  dpaReference: string
  isActive: boolean
  killSwitchActive: boolean
  createdAt: Date
  updatedAt: Date
}

type Row = {
  id: number; origin: string; label: string; dpaReference: string;
  isActive: boolean; killSwitchActive: boolean;
  createdAt: Date; updatedAt: Date;
}

function toDTO(r: Row): FhirAllowedSystemDTO {
  return {
    id: r.id, origin: r.origin, label: r.label,
    dpaReference: r.dpaReference,
    isActive: r.isActive, killSwitchActive: r.killSwitchActive,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  }
}

export type CreateInput = {
  origin: string
  label: string
  dpaReference: string
}
export type UpdateInput = {
  label?: string
  dpaReference?: string
  isActive?: boolean
  killSwitchActive?: boolean
}

export const fhirAllowedSystemService = {
  async list(): Promise<FhirAllowedSystemDTO[]> {
    const rows = await prisma.fhirAllowedSystem.findMany({
      orderBy: { origin: "asc" }, take: 200,
    })
    return rows.map(toDTO)
  },

  async create(input: CreateInput, auditUserId: number, ctx?: AuditContext): Promise<FhirAllowedSystemDTO> {
    if (!input.label || input.label.length > 200) throw new ValidationError("label")
    if (!input.dpaReference || input.dpaReference.length > 500) throw new ValidationError("dpaReference")
    const origin = normalizeAndValidateOrigin(input.origin)
    return prisma.$transaction(async (tx: Tx) => {
      try {
        const created = await tx.fhirAllowedSystem.create({
          data: {
            origin,
            label: input.label,
            dpaReference: input.dpaReference,
            createdBy: auditUserId,
          },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId, action: "CREATE", resource: "FHIR_ALLOWED_SYSTEM",
          resourceId: String(created.id),
          ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
          metadata: { origin, label: input.label, kind: "allowedSystem.create" },
        })
        return toDTO(created)
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
    id: number, input: UpdateInput, auditUserId: number, ctx?: AuditContext,
  ): Promise<FhirAllowedSystemDTO> {
    if (input.label !== undefined && (!input.label || input.label.length > 200)) {
      throw new ValidationError("label")
    }
    if (input.dpaReference !== undefined && (!input.dpaReference || input.dpaReference.length > 500)) {
      throw new ValidationError("dpaReference")
    }
    return prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.fhirAllowedSystem.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      const data: Prisma.FhirAllowedSystemUpdateInput = {}
      if (input.label !== undefined) data.label = input.label
      if (input.dpaReference !== undefined) data.dpaReference = input.dpaReference
      if (input.isActive !== undefined) data.isActive = input.isActive
      if (input.killSwitchActive !== undefined) data.killSwitchActive = input.killSwitchActive
      const updated = await tx.fhirAllowedSystem.update({ where: { id }, data })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "FHIR_ALLOWED_SYSTEM",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          origin: existing.origin, kind: "allowedSystem.update",
          updatedFields: Object.keys(input).filter((k) => input[k as keyof UpdateInput] !== undefined),
        },
      })
      return toDTO(updated)
    })
  },

  async deleteById(id: number, auditUserId: number, ctx?: AuditContext): Promise<{ deleted: true }> {
    return prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.fhirAllowedSystem.findUnique({ where: { id } })
      if (!existing) throw new NotFoundError()
      await tx.fhirAllowedSystem.delete({ where: { id } })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "DELETE", resource: "FHIR_ALLOWED_SYSTEM",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { origin: existing.origin, kind: "allowedSystem.delete" },
      })
      return { deleted: true as const }
    })
  },
}

export { normalizeAndValidateOrigin }
