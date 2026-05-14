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
import type { z } from "zod"
import { prisma, type PrismaClientOrTx as Tx } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { getEnvBoolean } from "@/lib/env"
import { auditService, type AuditContext } from "./audit.service"
import { NotFoundError, ValidationError } from "./team-workflow.errors"

/**
 * H9 — Retry sequence:
 *  - Attempt 1 (initial) fails → `retryCount: 1`, next at +1 min (BASE * 2^0)
 *  - Attempt 2 fails → `retryCount: 2`, next at +2 min (BASE * 2^1)
 *  - Attempt 3 fails → `retryCount: 3`, next at +4 min
 *  - Attempt 4 fails → `retryCount: 4`, next at +8 min
 *  - Attempt 5 fails → `retryCount: 5` (= MAX_RETRIES) → exhausted,
 *                      `nextRetryAt = null`, requires manual `retry()` (ADMIN).
 *
 * "Total attempts" = 5 (initial + 4 backed-off retries).
 */
// L7 (re-review) — DB constraint `fhir_interoperability_retry_count_check`
// in the migration must match this value (it caps at <= 5). Raising one
// without raising the other will cause INSERT/UPDATE to fail at the DB layer.
const MAX_RETRIES = 5
const BACKOFF_BASE_MS = 60_000 // 1 min, doubled per retry (1, 2, 4, 8 min)
const ERROR_MSG_MAX = 500
const SUPPORTED_RESOURCE_TYPES = ["Patient"] as const
export type FhirResourceType = (typeof SUPPORTED_RESOURCE_TYPES)[number]

// ─────────────────────────────────────────────────────────────
// FHIR R4 Patient resource (minimal, ANS-extensible)
//
// Inline ad-hoc type — `@types/fhir` is intentionally NOT imported to keep
// the bundle lean for the scaffold batch. When Observation / Medication /
// MedicationRequest are added (Batch 2+), revisit and consider the official
// types library. Discriminated union below ties resourceType to its concrete
// resource shape so future additions stay type-safe at the call site.
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

/** Discriminated union of FHIR resources accepted by `enqueue`. */
export type FhirResource = FhirPatientResource
/** Tighter `buildFhirPatient` return type — `identifier` and `active` are
 *  unconditionally set by the constructor. */
export type FhirPatientBuilt = FhirPatientResource &
  Required<Pick<FhirPatientResource, "identifier" | "active">>

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
}): FhirPatientBuilt {
  const resource: FhirPatientBuilt = {
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

/**
 * Truncate + redact a response body for safe audit logging.
 *
 * H4 — strips identifiers commonly echoed by FHIR servers in 4xx bodies :
 *  - INS / NIR / SNAS (13-17 digit runs, with optional spaces)
 *  - RPPS (11 digits) / ADELI (9 digits)
 *  - emails, phones, ISO dates (DOB)
 *
 * Replacement happens BEFORE truncation so a redaction at character ~480
 * still fits in `ERROR_MSG_MAX`.
 */
function sanitizeErrorMessage(input: unknown): string {
  if (input === null || input === undefined) return ""
  const s = typeof input === "string" ? input : (() => {
    try { return JSON.stringify(input) }
    catch { return String(input) }
  })()
  // Ordering matters — phone patterns must run BEFORE the pure digit-run
  // regex, otherwise `0612345678` gets tagged ID instead of PHONE (M1).
  // The phone matcher requires EITHER a leading `+` (intl), OR at least one
  // separator between groups, OR a French 10-digit number starting with `0`.
  // Unified 9-17 digit run closes the 12-digit gap (M2).
  const redacted = s
    // Phone with + prefix (international)
    .replace(/\+\d[\d\s.-]{7,}\d/g, "[REDACTED_PHONE]")
    // Phone with separator between digit groups (national formatted)
    .replace(/\b\d{1,4}[\s.-][\d\s.-]{6,}\d/g, "[REDACTED_PHONE]")
    // French 10-digit phone (mobile / landline, starts with 0)
    .replace(/\b0\d{9}\b/g, "[REDACTED_PHONE]")
    // Email
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[REDACTED_EMAIL]")
    // ISO date YYYY-MM-DD (DOB)
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "[REDACTED_DATE]")
    // Long digit runs cover INS/NIR/SNAS (13-17), RPPS (11), 12-digit FINESS,
    // ADELI (9), and arbitrary 10-digit IDs (other than FR phone, already
    // redacted above). Single unified pattern avoids gaps.
    .replace(/\b\d{9,17}\b/g, "[REDACTED_ID]")
  return redacted.slice(0, ERROR_MSG_MAX)
}

/**
 * H3 — strip query + fragment from a URL before audit logging so embedded
 * tokens / API keys never persist in the immutable audit table. Returns
 * `origin + pathname` only.
 *
 * L1 (re-review) — explicit `null` on parse failure so callers can fall back
 * to a sentinel like "[malformed]" only where appropriate, instead of writing
 * the literal sentinel into audit metadata.
 */
function stripUrlSecrets(url: string): string | null {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return null
  }
}

/** H5 — origin (scheme://host[:port]) extracted from a full URL for allowlist
 *  comparisons. Returns null if the URL is malformed. */
function extractOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// Service — queue / push / retry
// ─────────────────────────────────────────────────────────────

/**
 * Discriminated input — `resourceType` and `resource` are correlated so the
 * compiler prevents passing a Patient JSON under `"Observation"` (or vice
 * versa). The runtime `resourceTypeMismatch` check remains as defense in depth.
 */
export type EnqueueInput =
  | {
      patientId: number
      resourceType: "Patient"
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
  // H1 — https only (HDS: PHI must never travel unencrypted).
  if (!input.externalSystemUrl || !/^https:\/\//.test(input.externalSystemUrl)) {
    throw new ValidationError("externalSystemUrl")
  }
  if (input.resource.resourceType !== input.resourceType) {
    throw new ValidationError("resourceTypeMismatch")
  }
}

/**
 * M4 (re-review) — SSRF defense. Reject internal/loopback/RFC1918/cloud-metadata
 * hostnames even if (via legacy DB rows or compromise) they appear in the
 * allowlist. The admin write path enforces the same rule when creating rows,
 * so this is defense-in-depth.
 */
const FORBIDDEN_HOST_RE = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|::1|fe80:|metadata\.google\.internal)/i
const PRIVATE_IPV4_RE = /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/

function isForbiddenOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase()
    return FORBIDDEN_HOST_RE.test(host) || PRIVATE_IPV4_RE.test(host)
  } catch {
    return true
  }
}

/**
 * H5 — verify the target origin is in the allowlist + kill-switch is off.
 * Throws `ValidationError` ("systemNotAllowed" / "killSwitchActive" /
 * "forbiddenHost") on failure so the caller surfaces a 422.
 */
async function assertSystemAllowed(tx: Tx, url: string): Promise<void> {
  const origin = extractOrigin(url)
  if (!origin) throw new ValidationError("externalSystemUrl")
  if (isForbiddenOrigin(origin)) throw new ValidationError("forbiddenHost")
  const allowed = await tx.fhirAllowedSystem.findUnique({
    where: { origin },
    select: { isActive: true, killSwitchActive: true },
  })
  if (!allowed || !allowed.isActive) throw new ValidationError("systemNotAllowed")
  if (allowed.killSwitchActive) throw new ValidationError("killSwitchActive")
}

export const fhirInteropService = {
  /**
   * Queue a FHIR resource for outbound PUSH. The actual HTTP call is
   * triggered separately by a background worker (not in this PR — Batch 2).
   * Returns the persisted interop row with `pending` status.
   *
   * The payload is encrypted at rest. The plaintext FHIR JSON only exists
   * in memory inside the worker when it actually transmits it.
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

      // H5 — allowlist + kill-switch enforcement before any PHI is persisted.
      await assertSystemAllowed(tx, input.externalSystemUrl)

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
          // H3 — strip query/fragment so embedded tokens never persist in audit.
          systemUrl: stripUrlSecrets(input.externalSystemUrl),
        },
      })
      return toInteropDTO(row)
    })
  },

  async getById(id: number): Promise<FhirInteropDTO | null> {
    const row = await prisma.fhirInteroperability.findUnique({ where: { id } })
    return row ? toInteropDTO(row) : null
  },

  /** Decrypt the stored payload.
   *
   *  H4 (re-review) — when a `schema` is provided, runtime shape validation
   *  is enforced (Zod) before returning. Without a schema, the cast is unsafe
   *  but documented for the worker path that already knows the resource type.
   *
   *  Returns `null` if the row is missing, the ciphertext can't be decrypted,
   *  the plaintext isn't valid JSON, or the shape fails validation.
   */
  async getDecryptedPayload<T>(id: number, schema?: z.ZodType<T>): Promise<T | null> {
    const row = await prisma.fhirInteroperability.findUnique({
      where: { id }, select: { payloadEncrypted: true },
    })
    if (!row) return null
    const plaintext = safeDecryptField(row.payloadEncrypted)
    if (!plaintext) return null
    let parsed: unknown
    try { parsed = JSON.parse(plaintext) }
    catch { return null }
    if (schema) {
      const result = schema.safeParse(parsed)
      return result.success ? result.data : null
    }
    return parsed as T
  },

  /**
   * Mark a row as synced (worker calls this after a successful HTTP 2xx
   * from the FHIR server). Audits the result.
   */
  async markSynced(
    id: number, fhirResourceId: string, durationMs: number,
    auditUserId: number, ctx?: AuditContext,
  ): Promise<FhirInteropDTO> {
    // M5 (re-review) — strictly FHIR R4 spec §2.34.1: [A-Za-z0-9\-\.]{1,64}.
    //      No underscore (was permitted in the previous round, tightened now).
    //      Defends against log poisoning from a hostile FHIR server response.
    if (!/^[A-Za-z0-9.\-]{1,64}$/.test(fhirResourceId)) {
      throw new ValidationError("fhirResourceId")
    }
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
      // H1 (re-review) — re-check allowlist + kill-switch on manual retry.
      // An ADMIN that retries after the operator has revoked the destination
      // (RGPD Art. 28 DPA revocation) must NOT bypass the gate.
      await assertSystemAllowed(tx, row.externalSystemUrl)

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
   *
   * M9 (re-review) — after H2 SetNull, hard-deleted patient rows surface with
   * `patientId: null`. ADMIN global listing intentionally returns these for
   * forensic continuity (CNIL/ANS retention). Callers must NOT treat
   * `patientId === null` as an error — it represents "export emitted before
   * patient anonymisation".
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
   *
   * M7 (re-review) — delegate to the typed env getter to keep validation
   * and consumption in lockstep.
   */
  isEnabled(): boolean {
    return getEnvBoolean("FHIR_ENABLED") === true
  },

  /** Exposed for tests + worker. */
  MAX_RETRIES,
  BACKOFF_BASE_MS,
}

export { sanitizeErrorMessage }
