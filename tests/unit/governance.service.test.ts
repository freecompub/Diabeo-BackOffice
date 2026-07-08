/**
 * US-2657 (slice C) — Service de gouvernance de l'auto-application (frontière MDR).
 * Comportement de sécurité testé : activer EXIGE un artefact d'approbation (fail-closed) ; désactiver
 * est toujours permis ; idempotent ; audité `from → to` sans PHI ; patient scopé.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { governanceService } from "@/lib/services/governance.service"

const mkTx = (currentAutoApply: boolean | null) => ({
  patient: {
    findFirst: vi.fn().mockResolvedValue(currentAutoApply === null ? null : { autoApply: currentAutoApply }),
    update: vi.fn().mockResolvedValue({}),
  },
  governanceApproval: { create: vi.fn().mockResolvedValue({ id: 1 }) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
})

describe("governanceService.setAutoApply", () => {
  beforeEach(() => vi.clearAllMocks())

  it("activation : crée GovernanceApproval + pose le flag + audit", async () => {
    const tx = mkTx(false)
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))
    const res = await governanceService.setAutoApply(7, true, { reference: "GOV-2026-12", dpiaRef: "DPIA-AA" }, 3)
    expect(res).toEqual({ autoApply: true, changed: true })
    expect(tx.governanceApproval.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ patientId: 7, approvedById: 3, reference: "GOV-2026-12" }) }),
    )
    expect(tx.patient.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { autoApply: true } })
    expect(tx.auditLog.create).toHaveBeenCalled()
  })

  it("activation SANS référence → approvalRequired (fail-closed, aucune écriture)", async () => {
    const tx = mkTx(false)
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))
    await expect(governanceService.setAutoApply(7, true, null, 3)).rejects.toThrow("approvalRequired")
    await expect(governanceService.setAutoApply(7, true, { reference: "  " }, 3)).rejects.toThrow("approvalRequired")
  })

  it("désactivation : pose le flag false SANS approbation", async () => {
    const tx = mkTx(true)
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))
    const res = await governanceService.setAutoApply(7, false, null, 3)
    expect(res).toEqual({ autoApply: false, changed: true })
    expect(tx.governanceApproval.create).not.toHaveBeenCalled()
    expect(tx.patient.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { autoApply: false } })
  })

  it("re-approbation d'un patient déjà ON : trace l'approbation + audit, SANS update de flag", async () => {
    const tx = mkTx(true)
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))
    const res = await governanceService.setAutoApply(7, true, { reference: "GOV-REDECISION" }, 3)
    expect(res).toEqual({ autoApply: true, changed: false })
    expect(tx.governanceApproval.create).toHaveBeenCalled() // la re-décision est tracée
    expect(tx.auditLog.create).toHaveBeenCalled()
    expect(tx.patient.update).not.toHaveBeenCalled() // flag inchangé
  })

  it("désactivation idempotente (déjà OFF) → no-op complet (ni approbation, ni update, ni audit)", async () => {
    const tx = mkTx(false)
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))
    const res = await governanceService.setAutoApply(7, false, null, 3)
    expect(res).toEqual({ autoApply: false, changed: false })
    expect(tx.governanceApproval.create).not.toHaveBeenCalled()
    expect(tx.patient.update).not.toHaveBeenCalled()
    expect(tx.auditLog.create).not.toHaveBeenCalled()
  })

  it("patient absent → patientNotFound", async () => {
    const tx = mkTx(null)
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))
    await expect(governanceService.setAutoApply(7, false, null, 3)).rejects.toThrow("patientNotFound")
  })
})
