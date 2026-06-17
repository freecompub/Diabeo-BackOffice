/**
 * Test suite : encounter.service (US-2605 — mode revue de consultation).
 *
 * Comportements couverts :
 *  - openOrResume : reprend le brouillon du jour (audit READ) ou en crée un
 *    (audit CREATE) ; refus si hors périmètre.
 *  - saveDraft : propriétaire-only, statut draft, contenu chiffré, audit UPDATE.
 *  - finalizeReport : transaction (addendum immuable + encounter completed + draft
 *    vidé + 2 audits pivot) ; propriétaire-only ; refus si statut ≠ draft.
 *  - listReports : déchiffrement fail-soft + audit READ.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/access-control", () => ({ canAccessPatient: vi.fn() }))
vi.mock("@/lib/consent", () => ({ patientShareConsent: vi.fn() }))
vi.mock("@/lib/crypto/fields", () => ({
  encryptField: (v: string) => `enc:${v}`,
  safeDecryptField: (v: string | null) => (v ? v.replace(/^enc:/, "dec:") : v),
}))

import { encounterService, EncounterError } from "@/lib/services/encounter.service"
import { canAccessPatient } from "@/lib/access-control"
import { patientShareConsent } from "@/lib/consent"

const mockedAccess = vi.mocked(canAccessPatient)
const mockedConsent = vi.mocked(patientShareConsent)
const pm = prismaMock as unknown as {
  encounter: { findFirst: any; findUnique: any; create: any; update: any }
  consultationReportAddendum: { create: any; findMany: any }
  auditLog: { create: any }
  $transaction: any
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  mockedAccess.mockReset()
  mockedAccess.mockResolvedValue(true)
  mockedConsent.mockReset()
  mockedConsent.mockResolvedValue({ ok: true } as any)
  // $transaction(cb) → exécute le callback avec le mock comme `tx`.
  pm.$transaction.mockImplementation((cb: any) => cb(prismaMock))
})

const ENC = (over: Record<string, unknown> = {}) => ({
  id: 7, patientId: 42, openedById: 1, status: "draft",
  draftReportEnc: null, period: null, dataAsOf: null,
  openedAt: new Date("2026-06-16T09:00:00Z"), ...over,
})

describe("encounterService.openOrResume", () => {
  it("resumes today's existing draft (audit READ, no create)", async () => {
    pm.encounter.findFirst.mockResolvedValue(ENC({ draftReportEnc: "enc:wip" }))
    const r = await encounterService.openOrResume(42, 1, "DOCTOR")
    expect(r.id).toBe(7)
    expect(r.draftReport).toBe("dec:wip") // déchiffré
    expect(pm.encounter.create).not.toHaveBeenCalled()
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("READ")
    expect(audit.resource).toBe("ENCOUNTER")
    expect(audit.metadata.patientId).toBe(42)
  })

  it("creates a new draft when none open today (audit CREATE)", async () => {
    pm.encounter.findFirst.mockResolvedValue(null)
    pm.encounter.create.mockResolvedValue(ENC())
    const r = await encounterService.openOrResume(42, 1, "DOCTOR")
    expect(pm.encounter.create).toHaveBeenCalledWith({ data: { patientId: 42, openedById: 1 } })
    expect(r.draftReport).toBeNull()
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("CREATE")
  })

  it("throws forbidden when the caller cannot access the patient", async () => {
    mockedAccess.mockResolvedValue(false)
    await expect(encounterService.openOrResume(42, 1, "NURSE")).rejects.toBeInstanceOf(EncounterError)
    expect(pm.encounter.findFirst).not.toHaveBeenCalled()
  })
})

describe("encounterService.saveDraft", () => {
  it("encrypts + saves the draft for the owner, audits UPDATE", async () => {
    pm.encounter.findUnique.mockResolvedValue(ENC())
    pm.encounter.update.mockResolvedValue(ENC())
    await encounterService.saveDraft(7, 1, "DOCTOR", "mon brouillon")
    expect(pm.encounter.update.mock.calls[0][0].data.draftReportEnc).toBe("enc:mon brouillon")
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("UPDATE")
    expect(audit.metadata.patientId).toBe(42)
  })

  it("rejects a non-owner (forbidden)", async () => {
    pm.encounter.findUnique.mockResolvedValue(ENC({ openedById: 999 }))
    await expect(encounterService.saveDraft(7, 1, "DOCTOR", "x")).rejects.toMatchObject({ code: "forbidden" })
    expect(pm.encounter.update).not.toHaveBeenCalled()
  })

  it("rejects the owner if access was revoked mid-session (forbidden, no write)", async () => {
    pm.encounter.findUnique.mockResolvedValue(ENC())
    mockedAccess.mockResolvedValue(false)
    await expect(encounterService.saveDraft(7, 1, "DOCTOR", "x")).rejects.toMatchObject({ code: "forbidden" })
    expect(pm.encounter.update).not.toHaveBeenCalled()
  })

  it("rejects when not a draft (invalidState)", async () => {
    pm.encounter.findUnique.mockResolvedValue(ENC({ status: "completed" }))
    await expect(encounterService.saveDraft(7, 1, "DOCTOR", "x")).rejects.toMatchObject({ code: "invalidState" })
  })

  it("nulls the draft column when content is empty (no ciphertext of '')", async () => {
    pm.encounter.findUnique.mockResolvedValue(ENC())
    pm.encounter.update.mockResolvedValue(ENC())
    await encounterService.saveDraft(7, 1, "DOCTOR", "")
    expect(pm.encounter.update.mock.calls[0][0].data.draftReportEnc).toBeNull()
  })
})

describe("encounterService.finalizeReport", () => {
  it("emits an immutable addendum, completes the encounter, clears the draft, audits", async () => {
    pm.encounter.findUnique.mockResolvedValue(ENC({ draftReportEnc: "enc:wip" }))
    pm.consultationReportAddendum.create.mockResolvedValue({ id: 55 })
    pm.encounter.update.mockResolvedValue(ENC({ status: "completed" }))
    const dataAsOf = new Date("2026-06-16T10:00:00Z")

    const r = await encounterService.finalizeReport(7, 1, "DOCTOR", "compte rendu", { period: "14d", dataAsOf })

    expect(r).toEqual({ reportId: 55, patientId: 42 })
    const created = pm.consultationReportAddendum.create.mock.calls[0][0].data
    expect(created).toMatchObject({ encounterId: 7, patientId: 42, authorId: 1, content: "enc:compte rendu", period: "14d", dataAsOf })
    const upd = pm.encounter.update.mock.calls[0][0].data
    expect(upd).toMatchObject({ status: "completed", draftReportEnc: null })
    const audits = prismaMock.auditLog.create.mock.calls.map((c: any) => c[0].data.resource)
    expect(audits).toContain("CONSULTATION_REPORT")
    expect(audits).toContain("ENCOUNTER")
  })

  it("rejects finalize by a non-owner and when not a draft", async () => {
    pm.encounter.findUnique.mockResolvedValue(ENC({ openedById: 999 }))
    await expect(
      encounterService.finalizeReport(7, 1, "DOCTOR", "x", { period: "14d", dataAsOf: new Date() }),
    ).rejects.toMatchObject({ code: "forbidden" })

    pm.encounter.findUnique.mockResolvedValue(ENC({ status: "abandoned" }))
    await expect(
      encounterService.finalizeReport(7, 1, "DOCTOR", "x", { period: "14d", dataAsOf: new Date() }),
    ).rejects.toMatchObject({ code: "invalidState" })
  })

  it("rejects finalize if access revoked or sharing withdrawn (no immutable write)", async () => {
    pm.encounter.findUnique.mockResolvedValue(ENC())
    mockedAccess.mockResolvedValue(false)
    await expect(
      encounterService.finalizeReport(7, 1, "DOCTOR", "CR", { period: "14d", dataAsOf: new Date() }),
    ).rejects.toMatchObject({ code: "forbidden" })

    mockedAccess.mockResolvedValue(true)
    mockedConsent.mockResolvedValue({ ok: false, status: 403, error: "sharingDisabled" } as any)
    await expect(
      encounterService.finalizeReport(7, 1, "DOCTOR", "CR", { period: "14d", dataAsOf: new Date() }),
    ).rejects.toMatchObject({ code: "forbidden" })
    expect(pm.consultationReportAddendum.create).not.toHaveBeenCalled()
  })

  it("rejects an empty/whitespace report before any write (invalidState)", async () => {
    await expect(
      encounterService.finalizeReport(7, 1, "DOCTOR", "   ", { period: "14d", dataAsOf: new Date() }),
    ).rejects.toMatchObject({ code: "invalidState" })
    expect(pm.encounter.findUnique).not.toHaveBeenCalled()
    expect(pm.consultationReportAddendum.create).not.toHaveBeenCalled()
  })
})

describe("encounterService.listReports", () => {
  it("returns finalized reports with fail-soft decryption + audit READ", async () => {
    pm.consultationReportAddendum.findMany.mockResolvedValue([
      { id: 1, encounterId: 7, content: "enc:body", period: "14d", dataAsOf: new Date("2026-06-16T10:00:00Z"), createdAt: new Date("2026-06-16T10:05:00Z") },
    ])
    const out = await encounterService.listReports(42, 1, "DOCTOR")
    expect(out[0].content).toBe("dec:body")
    expect(out[0].period).toBe("14d")
    const where = pm.consultationReportAddendum.findMany.mock.calls[0][0].where
    expect(where).toEqual({ patientId: 42, deletedAt: null })
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("READ")
    expect(audit.resource).toBe("CONSULTATION_REPORT")
  })

  it("throws forbidden when the caller cannot access the patient", async () => {
    mockedAccess.mockResolvedValue(false)
    await expect(encounterService.listReports(42, 1, "NURSE")).rejects.toBeInstanceOf(EncounterError)
    expect(pm.consultationReportAddendum.findMany).not.toHaveBeenCalled()
  })
})
