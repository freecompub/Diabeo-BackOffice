/**
 * @module fhir-interop.service
 * @description Groupe 8 i18n/Interop Batch 1 — US-2123 (HL7 FHIR R4, ~3 SP).
 *
 * Scope (Batch 1):
 *  - Build a FHIR R4 `Patient` resource from an internal Patient (decrypted
 *    PHI only inside the serializer ; encrypted at rest in `payload_encrypted`)
 *  - Queue the outbound PUSH (synchronous HTTP call gated by `FHIR_ENABLED`
 *    env flag — scaffold mode by default for CI / non-prod envs)
 *  - Retry with exponential backoff (max 5 attempts) on transient failures
 *  - Audit every queue/push/retry as `FHIR_INTEROP`
 *
 * Out of scope (deferred):
 *  - PULL flow (read from external FHIR server)
 *  - Bundle transactions / batch
 *  - Observation/Medication/MedicationRequest resources
 *  - ANS HL7-fr profile constraints (system identifiers, INS-mapped)
 *  - mTLS / OAuth2 client credentials grant to the FHIR server
 *
 * Activation prerequisites (when going live):
 *  - `FHIR_ENABLED=true` env var
 *  - `FHIR_PATIENT_SYSTEM_URL` (system identifier, e.g. `https://ans.fr/ins`)
 *  - External FHIR server URL stored per-resource on `externalSystemUrl`
 *  - Outbound HTTPS allowlist + DPA in place
 *
 * **No PHI in `errorMessage`** — service truncates external response bodies
 * to 500 chars and strips obvious PII patterns before storage.
 */

import { Prisma, FhirSyncStatus } from "@prisma/client"
import { prisma, type PrismaClientOrTx as Tx } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { auditService, type AuditContext } from "./audit.service"
import { NotFoundError, ValidationError } from "./team-workflow.errors"

const MAX_RETRIES = 5
const BACKOFF_BASE_MS = 60_000 // 1 min, doubling each retry (1, 2, 4, 8, 16 min)
const ERROR_MSG_MAX = 500
const SUPPORTED_RESOURCE_TYPES = ["Patient"] as const
export type FhirResourceType = (typeof SUPPORTED_RESOURCE_TYPES)[number]

// ─────────────────────────────────────────────────────────────
// FHIR R4 Patient resource (minimal, ANS-extensible)
// ─────────────────────────────────────────────────────────────

export type FhirPatientResource = {
  resourceType: "Patient"
  id?: string
  identifier?: Array<{
    system: string
    value: string
  }>
  active?: boolean
  name?: Array<{
    use?: "official" | "usual"
    family: string
    given: string[]
  }>
  gender?: "male" | "female" | "other" | "unknown"
  birthDate?: string  // YYYY-MM-DD
}

/**
 * Build a minimal FHIR R4 Patient resource from internal data.
 *
 * Caller is responsible for decrypting the input fields *before* invoking
 * this helper — the function itself only assembles the JSON. The caller
 * passes already-decrypted plaintexts to keep this helper PHI-agnostic
 * and easy to test.
 */
export function buildFhirPatient(input: {
  internalId: number
  systemUrl: string
  firstname: string | null
  lastname: string | null
  birthday: Date | null
  gender?: "male" | "female" | "other" | "unknown"
}): FhirPatientResource {
  const resource: FhirPatientResource = {
    resourceType: "Patient",
    identifier: [{ system: input.systemUrl, value: String(input.internalId) }],
    active: true,
  }
  if (input.firstname || input.lastname) {
    resource.name = [{
      use: "official",
      family: input.lastname ?? "",
      given: input.firstname ? [input.firstname] : [],
    }]
  }
  if (input.birthday) {
    resource.birthDate = input.birthday.toISOString().slice(0, 10)
  }
  if (input.gender) resource.gender = input.gender
  return resource
}

/** Truncate + redact a response body for safe audit logging. */
function sanitizeErrorMessage(input: unknown): string {
  if (input === null || input === undefined) return ""
  const s = typeof input === "string" ? input : (() => {
    try { return JSON.stringify(input) }
    catch { return String(input) }
  })()
  // Strip well-known PHI patterns (INS/NIR/RPPS digits) before truncation.
  const redacted = s
    .replace(/\b\d{13,15}\b/g, "[REDACTED_ID]")
    .replace(/\b\d{2}\d{2}\d{2}\d{3}\d{3}\d{2}\b/g, "[REDACTED_INS]")
  return redacted.slice(0, ERROR_MSG_MAX)
}

// ─────────────────────────────────────────────────────────────
// Service — queue / push / retry
// ─────────────────────────────────────────────────────────────

export type EnqueueInput = {
  patientId: number
  resourceType: FhirResourceType
  externalSystemUrl: string
  resource: FhirPatientResource
}

export type FhirInteropDTO = {
  id: number
  patientId: number | null
  resourceType: string
  externalSystemUrl: string
  fhirResourceId: string | null
  syncStatus: FhirSyncStatus
  retryCount: number
  nextRetryAt: Date | null
  lastSyncedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function toInteropDTO(r: {
  id: number; patientId: number | null;
  resourceType: string; externalSystemUrl: string;
  fhirResourceId: string | null; syncStatus: FhirSyncStatus;
  retryCount: number; nextRetryAt: Date | null;
  lastSyncedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}): FhirInteropDTO {
  return {
    id: r.id, patientId: r.patientId,
    resourceType: r.resourceType, externalSystemUrl: r.externalSystemUrl,
    fhirResourceId: r.fhirResourceId, syncStatus: r.syncStatus,
    retryCount: r.retryCount, nextRetryAt: r.nextRetryAt,
    lastSyncedAt: r.lastSyncedAt,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
  }
}

function validateEnqueueInput(input: EnqueueInput) {
  if (!SUPPORTED_RESOURCE_TYPES.includes(input.resourceType)) {
    throw new ValidationError("unsupportedResourceType")
  }
  if (!input.externalSystemUrl || !/^https?:\/\//.test(input.externalSystemUrl)) {
    throw new ValidationError("externalSystemUrl")
  }
  if (input.resource.resourceType !== input.resourceType) {
    throw new ValidationError("resourceTypeMismatch")
  }
}

export const fhirInteropService = {
  /**
   * Queue a FHIR resource for outbound PUSH. The actual HTTP call is
   * triggered separately by `pushOnce` or a background worker. Returns the
   * persisted interop row with `pending` status.
   *
   * The payload is encrypted at rest. The plaintext FHIR JSON only exists
   * in memory inside `pushOnce` when the worker actually transmits it.
   */
  async enqueue(
    input: EnqueueInput, auditUserId: number, ctx?: AuditContext,
  ): Promise<FhirInteropDTO> {
    validateEnqueueInput(input)
    const payloadJson = JSON.stringify(input.resource)

    return prisma.$transaction(async (tx: Tx) => {
      const patient = await tx.patient.findFirst({
        where: { id: input.patientId, deletedAt: null }, select: { id: true },
      })
      if (!patient) throw new NotFoundError()

      const row = await tx.fhirInteroperability.create({
        data: {
          patientId: input.patientId,
          resourceType: input.resourceType,
          externalSystemUrl: input.externalSystemUrl,
          payloadEncrypted: encryptField(payloadJson),
          syncStatus: FhirSyncStatus.pending,
          retryCount: 0,
          nextRetryAt: new Date(),
          createdBy: auditUserId,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "CREATE", resource: "FHIR_INTEROP",
        resourceId: String(row.id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: input.patientId,
          resourceType: input.resourceType,
          systemUrl: input.externalSystemUrl,
        },
      })
      return toInteropDTO(row)
    })
  },

  async getById(id: number): Promise<FhirInteropDTO | null> {
    const row = await prisma.fhirInteroperability.findUnique({ where: { id } })
    return row ? toInteropDTO(row) : null
  },

  /** Decrypt the stored payload — only callers that need the plaintext
   *  (the worker about to PUSH) should invoke this. */
  async getDecryptedPayload(id: number): Promise<unknown | null> {
    const row = await prisma.fhirInteroperability.findUnique({
      where: { id }, select: { payloadEncrypted: true },
    })
    if (!row) return null
    const plaintext = safeDecryptField(row.payloadEncrypted)
    if (!plaintext) return null
    try { return JSON.parse(plaintext) }
    catch { return null }
  },

  /**
   * Mark a row as synced (worker calls this after a successful HTTP 2xx
   * from the FHIR server). Audits the result.
   */
  async markSynced(
    id: number, fhirResourceId: string, durationMs: number,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<FhirInteropDTO> {
    return prisma.$transaction(async (tx: Tx) => {
      const row = await tx.fhirInteroperability.findUnique({ where: { id } })
      if (!row) throw new NotFoundError()
      const updated = await tx.fhirInteroperability.update({
        where: { id },
        data: {
          syncStatus: FhirSyncStatus.synced,
          fhirResourceId,
          lastSyncedAt: new Date(),
          nextRetryAt: null,
        },
      })
      await tx.fhirSyncLog.create({
        data: {
          interopId: id, action: "PUSH",
          httpStatus: 200,
          durationMs,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "FHIR_INTEROP",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: row.patientId,
          kind: "synced",
          fhirResourceId,
          durationMs,
        },
      })
      return toInteropDTO(updated)
    })
  },

  /**
   * Mark a row as failed and schedule a retry with exponential backoff. After
   * `MAX_RETRIES` failures the row stays `failed` until a manual `retry`.
   */
  async markFailed(
    id: number, httpStatus: number | null, error: unknown, durationMs: number,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<FhirInteropDTO> {
    const errorMessage = sanitizeErrorMessage(error)
    return prisma.$transaction(async (tx: Tx) => {
      const row = await tx.fhirInteroperability.findUnique({ where: { id } })
      if (!row) throw new NotFoundError()
      const nextRetry = row.retryCount + 1
      const exhausted = nextRetry >= MAX_RETRIES
      const nextRetryAt = exhausted
        ? null
        : new Date(Date.now() + BACKOFF_BASE_MS * Math.pow(2, row.retryCount))
      const updated = await tx.fhirInteroperability.update({
        where: { id },
        data: {
          syncStatus: FhirSyncStatus.failed,
          retryCount: nextRetry,
          nextRetryAt,
        },
      })
      await tx.fhirSyncLog.create({
        data: {
          interopId: id, action: "PUSH",
          httpStatus, errorMessage, durationMs,
        },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "FHIR_INTEROP",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: {
          patientId: row.patientId,
          kind: "failed",
          httpStatus, retryCount: nextRetry, exhausted,
        },
      })
      return toInteropDTO(updated)
    })
  },

  /**
   * Manually retry a `failed` row — resets retry counter and schedules
   * an immediate next attempt. ADMIN-only at route layer.
   */
  async retry(
    id: number, auditUserId: number, ctx?: AuditContext,
  ): Promise<FhirInteropDTO> {
    return prisma.$transaction(async (tx: Tx) => {
      const row = await tx.fhirInteroperability.findUnique({ where: { id } })
      if (!row) throw new NotFoundError()
      if (row.syncStatus !== FhirSyncStatus.failed) {
        throw new ValidationError("notFailed")
      }
      const updated = await tx.fhirInteroperability.update({
        where: { id },
        data: {
          syncStatus: FhirSyncStatus.pending,
          retryCount: 0,
          nextRetryAt: new Date(),
        },
      })
      await tx.fhirSyncLog.create({
        data: { interopId: id, action: "RETRY" },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId, action: "UPDATE", resource: "FHIR_INTEROP",
        resourceId: String(id),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        metadata: { patientId: row.patientId, kind: "manual-retry" },
      })
      return toInteropDTO(updated)
    })
  },

  /**
   * List sync status with optional filters. ADMIN/DOCTOR read.
   */
  async listStatus(filter?: {
    patientId?: number;
    syncStatus?: FhirSyncStatus;
    resourceType?: FhirResourceType;
  }): Promise<{ items: FhirInteropDTO[]; truncated: boolean }> {
    const LIMIT = 100
    const rows = await prisma.fhirInteroperability.findMany({
      where: {
        ...(filter?.patientId !== undefined && { patientId: filter.patientId }),
        ...(filter?.syncStatus && { syncStatus: filter.syncStatus }),
        ...(filter?.resourceType && { resourceType: filter.resourceType }),
      },
      orderBy: { createdAt: "desc" },
      take: LIMIT + 1,
      select: {
        id: true, patientId: true, resourceType: true, externalSystemUrl: true,
        fhirResourceId: true, syncStatus: true, retryCount: true,
        nextRetryAt: true, lastSyncedAt: true,
        createdAt: true, updatedAt: true,
      },
    })
    const truncated = rows.length > LIMIT
    return {
      items: (truncated ? rows.slice(0, LIMIT) : rows).map(toInteropDTO),
      truncated,
    }
  },

  /**
   * Feature flag check. When `FHIR_ENABLED!=="true"`, the queue stays in
   * scaffold mode — items remain `pending` and no outbound HTTP fires.
   */
  isEnabled(): boolean {
    return process.env.FHIR_ENABLED === "true"
  },

  /** Exposed for tests + worker. */
  MAX_RETRIES,
  BACKOFF_BASE_MS,
}

export { sanitizeErrorMessage }
