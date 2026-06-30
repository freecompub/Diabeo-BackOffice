/**
 * US-2631 (socle fiche patient) — détection CGM vs BGM.
 *
 * Comportement testé : `patientHasCgm` = vrai si capteur CGM actif OU relevés
 * CGM récents (< 14 j). Risque : un faux négatif basculerait à tort la fiche en
 * présentation BGM (perte des métriques CGM) ; un faux positif afficherait un
 * TIR/GMI/AGP trompeur à un patient sans capteur.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { cgmStatusService } from "@/lib/services/cgm-status.service"

describe("cgmStatusService.patientHasCgm (US-2631)", () => {
  beforeEach(() => {
    prismaMock.patientDevice.findFirst.mockReset()
    prismaMock.cgmEntry.findFirst.mockReset()
  })

  it("true when an active CGM sensor exists (no fallback query)", async () => {
    prismaMock.patientDevice.findFirst.mockResolvedValue({ patientId: 1 } as any)
    expect(await cgmStatusService.patientHasCgm(1)).toBe(true)
    expect(prismaMock.cgmEntry.findFirst).not.toHaveBeenCalled()
  })

  it("true via the recent-CGM fallback when no active sensor", async () => {
    prismaMock.patientDevice.findFirst.mockResolvedValue(null)
    prismaMock.cgmEntry.findFirst.mockResolvedValue({ patientId: 1 } as any)
    expect(await cgmStatusService.patientHasCgm(1)).toBe(true)
  })

  it("false when no sensor and no recent CGM (→ BGM)", async () => {
    prismaMock.patientDevice.findFirst.mockResolvedValue(null)
    prismaMock.cgmEntry.findFirst.mockResolvedValue(null)
    expect(await cgmStatusService.patientHasCgm(1)).toBe(false)
  })
})
