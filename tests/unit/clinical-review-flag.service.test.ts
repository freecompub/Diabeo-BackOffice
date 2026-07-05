/**
 * Tests — clinicalReviewFlagService.raise (US-2651 mode c / US-2646).
 *
 * Comportement clinique/sécurité :
 * - Idempotence : un flag `open` du même type déjà présent → aucune création (anti-spam).
 * - Aucune posologie dans le flag (frontière dispositif médical) ; audit sans PHI.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/services/audit.service", () => ({ auditService: { log: vi.fn() } }))

import { clinicalReviewFlagService } from "@/lib/services/clinical-review-flag.service"
import { auditService } from "@/lib/services/audit.service"

describe("clinicalReviewFlagService.raise", () => {
  beforeEach(() => vi.clearAllMocks())

  it("crée un flag quand aucun `open` du même type + audit CREATE sans PHI", async () => {
    prismaMock.clinicalReviewFlag.findFirst.mockResolvedValue(null)
    prismaMock.clinicalReviewFlag.create.mockResolvedValue({ id: "f1" } as never)

    const res = await clinicalReviewFlagService.raise(5, "reviewInConsultation", 20)

    expect(res).toEqual({ flagId: "f1", created: true })
    expect(prismaMock.clinicalReviewFlag.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { patientId: 5, type: "reviewInConsultation", createdBy: 20 } }),
    )
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CREATE",
        resource: "CLINICAL_REVIEW_FLAG",
        resourceId: "f1",
        metadata: { patientId: 5, type: "reviewInConsultation" },
      }),
    )
  })

  it("idempotent : un flag `open` existant → aucune création", async () => {
    prismaMock.clinicalReviewFlag.findFirst.mockResolvedValue({ id: "existing" } as never)

    const res = await clinicalReviewFlagService.raise(5, "reviewInConsultation", 20)

    expect(res).toEqual({ flagId: "existing", created: false })
    expect(prismaMock.clinicalReviewFlag.create).not.toHaveBeenCalled()
    expect(auditService.log).not.toHaveBeenCalled()
  })
})
