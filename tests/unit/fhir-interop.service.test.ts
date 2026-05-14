/**
 * Test suite: fhir-interop.service (US-2123)
 *
 * Covers:
 *  - FHIR R4 Patient resource builder (PHI-agnostic; caller decrypts)
 *  - enqueue: validates resourceType/URL, encrypts payload, audits
 *  - markSynced / markFailed: state transitions + exponential backoff
 *  - retry: ADMIN flow, only on `failed` status
 *  - sanitizeErrorMessage: redact INS/NIR digits, truncate to 500 chars
 *  - feature flag (FHIR_ENABLED)
 */
import { FhirSyncStatus } from "@prisma/client"
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  fhirInteropService,
  buildFhirPatient,
  sanitizeErrorMessage,
} from "@/lib/services/fhir-interop.service"
import {
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

// ─────────────────────────────────────────────────────────────
// buildFhirPatient
// ─────────────────────────────────────────────────────────────

describe("buildFhirPatient", () => {
  it("builds minimal Patient resource with identifier", () => {
    const r = buildFhirPatient({
      internalId: 42,
      systemUrl: "urn:diabeo:patient",
      firstname: "Jean",
      lastname: "Dupont",
      birthday: new Date("1980-01-15"),
    })
    expect(r.resourceType).toBe("Patient")
    expect(r.identifier?.[0].value).toBe("42")
    expect(r.name?.[0].family).toBe("Dupont")
    expect(r.name?.[0].given).toEqual(["Jean"])
    expect(r.birthDate).toBe("1980-01-15")
  })
  it("omits name when both firstname and lastname are null", () => {
    const r = buildFhirPatient({
      internalId: 1, systemUrl: "urn:diabeo:patient",
      firstname: null, lastname: null, birthday: null,
    })
    expect(r.name).toBeUndefined()
    expect(r.birthDate).toBeUndefined()
  })
  it("includes gender when provided", () => {
    const r = buildFhirPatient({
      internalId: 1, systemUrl: "urn:diabeo:patient",
      firstname: "A", lastname: "B", birthday: null, gender: "female",
    })
    expect(r.gender).toBe("female")
  })
})

// ─────────────────────────────────────────────────────────────
// sanitizeErrorMessage
// ─────────────────────────────────────────────────────────────

describe("sanitizeErrorMessage", () => {
  it("truncates to 500 chars", () => {
    const long = "x".repeat(1200)
    expect(sanitizeErrorMessage(long).length).toBe(500)
  })
  it("redacts long digit sequences (INS/NIR-shaped)", () => {
    const msg = "Failed with id 290017512345678 (NIR)"
    const out = sanitizeErrorMessage(msg)
    expect(out).toContain("[REDACTED")
    expect(out).not.toContain("290017512345678")
  })
  it("H4 — redacts RPPS (11 digits), ADELI (9), email, DOB", () => {
    const msg = "RPPS 10003456789 ADELI 759104215 email John.Doe@example.fr DOB 1985-03-12"
    const out = sanitizeErrorMessage(msg)
    expect(out).not.toContain("10003456789")
    expect(out).not.toContain("759104215")
    expect(out).not.toContain("Doe@example.fr")
    expect(out).not.toContain("1985-03-12")
  })
  it("H4 — redacts phone numbers", () => {
    const msg = "Contact +33 6 12 34 56 78"
    const out = sanitizeErrorMessage(msg)
    expect(out).toContain("[REDACTED_PHONE]")
  })
  it("safely stringifies non-string inputs", () => {
    const out = sanitizeErrorMessage({ status: 500, detail: "boom" })
    expect(out).toContain("status")
  })
  it("returns empty string on null/undefined", () => {
    expect(sanitizeErrorMessage(null)).toBe("")
    expect(sanitizeErrorMessage(undefined)).toBe("")
  })
})

// ─────────────────────────────────────────────────────────────
// enqueue
// ─────────────────────────────────────────────────────────────

describe("fhirInteropService.enqueue", () => {
  const resource = buildFhirPatient({
    internalId: 7, systemUrl: "urn:diabeo:patient",
    firstname: "Jean", lastname: "Dupont", birthday: new Date("1980-01-15"),
  })

  it("rejects unsupported resourceType", async () => {
    await expect(
      fhirInteropService.enqueue(
        {
          patientId: 7, resourceType: "Medication" as any,
          externalSystemUrl: "https://fhir.example.com/",
          resource,
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects non-https externalSystemUrl (H1)", async () => {
    await expect(
      fhirInteropService.enqueue(
        {
          patientId: 7, resourceType: "Patient",
          externalSystemUrl: "http://fhir.example.com/",
          resource,
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects when origin not in allowlist (H5)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.fhirAllowedSystem.findUnique.mockResolvedValue(null)
    await expect(
      fhirInteropService.enqueue(
        {
          patientId: 7, resourceType: "Patient",
          externalSystemUrl: "https://rogue.example.com/Patient",
          resource,
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects when kill-switch is active (H5)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.fhirAllowedSystem.findUnique.mockResolvedValue({
      isActive: true, killSwitchActive: true,
    } as any)
    await expect(
      fhirInteropService.enqueue(
        {
          patientId: 7, resourceType: "Patient",
          externalSystemUrl: "https://fhir.example.com/",
          resource,
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects when resourceType doesn't match resource.resourceType", async () => {
    await expect(
      fhirInteropService.enqueue(
        {
          patientId: 7, resourceType: "Patient",
          externalSystemUrl: "https://fhir.example.com/",
          resource: { ...resource, resourceType: "Observation" as any },
        }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects when patient is missing/soft-deleted", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(
      fhirInteropService.enqueue(
        {
          patientId: 999, resourceType: "Patient",
          externalSystemUrl: "https://fhir.example.com/",
          resource,
        }, 9,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
  it("enqueues + encrypts payload + audits", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.fhirAllowedSystem.findUnique.mockResolvedValue({
      isActive: true, killSwitchActive: false,
    } as any)
    prismaMock.fhirInteroperability.create.mockResolvedValue({
      id: 1, patientId: 7,
      resourceType: "Patient",
      externalSystemUrl: "https://fhir.example.com/",
      fhirResourceId: null,
      syncStatus: FhirSyncStatus.pending,
      retryCount: 0, nextRetryAt: new Date(),
      lastSyncedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await fhirInteropService.enqueue(
      {
        patientId: 7, resourceType: "Patient",
        externalSystemUrl: "https://fhir.example.com/",
        resource,
      }, 9,
    )
    expect(out.syncStatus).toBe("pending")
    const insertArgs = prismaMock.fhirInteroperability.create.mock.calls[0][0] as any
    expect(insertArgs.data.payloadEncrypted).toBeTruthy()
    expect(insertArgs.data.payloadEncrypted).not.toContain("Dupont")
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.resource).toBe("FHIR_INTEROP")
  })
})

// ─────────────────────────────────────────────────────────────
// markSynced / markFailed / retry
// ─────────────────────────────────────────────────────────────

describe("fhirInteropService.markSynced", () => {
  it("M2 — rejects invalid fhirResourceId charset", async () => {
    await expect(
      fhirInteropService.markSynced(1, "ext id with space", 200, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("M2 — rejects fhirResourceId > 64 chars", async () => {
    await expect(
      fhirInteropService.markSynced(1, "a".repeat(65), 200, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("transitions to synced + logs durationMs", async () => {
    prismaMock.fhirInteroperability.findUnique.mockResolvedValue({
      id: 1, patientId: 7, syncStatus: FhirSyncStatus.pending,
      retryCount: 0,
    } as any)
    prismaMock.fhirInteroperability.update.mockResolvedValue({
      id: 1, patientId: 7,
      resourceType: "Patient", externalSystemUrl: "https://fhir.example.com/",
      fhirResourceId: "ext-123",
      syncStatus: FhirSyncStatus.synced,
      retryCount: 0, nextRetryAt: null,
      lastSyncedAt: new Date(),
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await fhirInteropService.markSynced(1, "ext-123", 245, 9)
    expect(out.syncStatus).toBe("synced")
    const logArgs = prismaMock.fhirSyncLog.create.mock.calls[0][0] as any
    expect(logArgs.data.durationMs).toBe(245)
    expect(logArgs.data.httpStatus).toBe(200)
  })
})

describe("fhirInteropService.markFailed", () => {
  it("schedules exponential backoff retry until MAX_RETRIES reached", async () => {
    prismaMock.fhirInteroperability.findUnique.mockResolvedValue({
      id: 1, patientId: 7, retryCount: 0,
    } as any)
    prismaMock.fhirInteroperability.update.mockResolvedValue({
      id: 1, patientId: 7,
      resourceType: "Patient", externalSystemUrl: "https://fhir.example.com/",
      fhirResourceId: null,
      syncStatus: FhirSyncStatus.failed,
      retryCount: 1,
      nextRetryAt: new Date(Date.now() + 60_000),
      lastSyncedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await fhirInteropService.markFailed(1, 503, "Upstream timeout", 1200, 9)
    expect(out.syncStatus).toBe("failed")
    expect(out.retryCount).toBe(1)
    expect(out.nextRetryAt).not.toBeNull()
  })
  it("exhausts retries after MAX_RETRIES (nextRetryAt = null)", async () => {
    prismaMock.fhirInteroperability.findUnique.mockResolvedValue({
      id: 1, patientId: 7, retryCount: fhirInteropService.MAX_RETRIES - 1,
    } as any)
    prismaMock.fhirInteroperability.update.mockResolvedValue({
      id: 1, patientId: 7,
      resourceType: "Patient", externalSystemUrl: "https://fhir.example.com/",
      fhirResourceId: null,
      syncStatus: FhirSyncStatus.failed,
      retryCount: fhirInteropService.MAX_RETRIES,
      nextRetryAt: null,
      lastSyncedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await fhirInteropService.markFailed(1, 500, "boom", 200, 9)
    expect(out.nextRetryAt).toBeNull()
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.exhausted).toBe(true)
  })
  it("sanitizes PHI-shaped digits before persisting errorMessage", async () => {
    prismaMock.fhirInteroperability.findUnique.mockResolvedValue({
      id: 1, patientId: 7, retryCount: 0,
    } as any)
    prismaMock.fhirInteroperability.update.mockResolvedValue({
      id: 1, patientId: 7,
      resourceType: "Patient", externalSystemUrl: "https://fhir.example.com/",
      fhirResourceId: null,
      syncStatus: FhirSyncStatus.failed,
      retryCount: 1, nextRetryAt: new Date(),
      lastSyncedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    await fhirInteropService.markFailed(
      1, 422, "Invalid identifier 290017512345678 in payload", 100, 9,
    )
    const logArgs = prismaMock.fhirSyncLog.create.mock.calls[0][0] as any
    expect(logArgs.data.errorMessage).not.toContain("290017512345678")
    expect(logArgs.data.errorMessage).toContain("[REDACTED")
  })
})

describe("fhirInteropService.retry", () => {
  it("rejects when not in failed status", async () => {
    prismaMock.fhirInteroperability.findUnique.mockResolvedValue({
      id: 1, patientId: 7, syncStatus: FhirSyncStatus.synced,
    } as any)
    await expect(fhirInteropService.retry(1, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })
  it("resets retryCount + schedules immediate retry", async () => {
    prismaMock.fhirInteroperability.findUnique.mockResolvedValue({
      id: 1, patientId: 7, syncStatus: FhirSyncStatus.failed, retryCount: 5,
    } as any)
    prismaMock.fhirInteroperability.update.mockResolvedValue({
      id: 1, patientId: 7,
      resourceType: "Patient", externalSystemUrl: "https://fhir.example.com/",
      fhirResourceId: null,
      syncStatus: FhirSyncStatus.pending,
      retryCount: 0, nextRetryAt: new Date(),
      lastSyncedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await fhirInteropService.retry(1, 9)
    expect(out.syncStatus).toBe("pending")
    expect(out.retryCount).toBe(0)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.kind).toBe("manual-retry")
  })
})

// ─────────────────────────────────────────────────────────────
// Feature flag
// ─────────────────────────────────────────────────────────────

describe("fhirInteropService.isEnabled", () => {
  it("returns false when FHIR_ENABLED is unset or != true", () => {
    delete process.env.FHIR_ENABLED
    expect(fhirInteropService.isEnabled()).toBe(false)
    process.env.FHIR_ENABLED = "false"
    expect(fhirInteropService.isEnabled()).toBe(false)
  })
  it("returns true when FHIR_ENABLED=true", () => {
    process.env.FHIR_ENABLED = "true"
    expect(fhirInteropService.isEnabled()).toBe(true)
    delete process.env.FHIR_ENABLED
  })
})
