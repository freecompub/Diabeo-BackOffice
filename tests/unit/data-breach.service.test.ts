/**
 * @description Groupe 9 — US-2137 DataBreach unit tests.
 *
 * Couvre :
 *   - declare : validation title/description/detectedAt + encryption
 *   - FSM transitions autorisées / refusées
 *   - cnilDeadlineHoursRemaining computed pour severity high/critical
 *   - audit kind par transition
 */
import { describe, it, expect, beforeEach } from "vitest"
import { DataBreachStatus, DataBreachSeverity } from "@prisma/client"
import { prismaMock } from "../helpers/prisma-mock"
import {
  dataBreachService,
  DataBreachValidationError,
  DataBreachStateError,
  DataBreachNotFoundError,
} from "@/lib/services/data-breach.service"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"

const baseBreach = {
  id: 1,
  severity: DataBreachSeverity.critical,
  status: DataBreachStatus.draft,
  title: "Test breach",
  descriptionEnc: null,
  remediationEnc: null,
  cnilCaseNumberEnc: null,
  usersNotifiedCount: 0,
  detectedAt: new Date(),
  declaredBy: 9,
  cnilNotifiedAt: null,
  usersNotifiedAt: null,
  closedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

describe("declare (US-2137)", () => {
  it("creates draft breach + encrypts description", async () => {
    prismaMock.dataBreach.create.mockResolvedValue({
      ...baseBreach, descriptionEnc: encryptField("plaintext desc"),
    } as any)
    const out = await dataBreachService.declare({
      severity: DataBreachSeverity.high,
      title: "Phishing email lot users",
      description: "plaintext desc",
    }, 9)
    expect(out.status).toBe("draft")
    expect(out.description).toBe("plaintext desc")
    const callArg = prismaMock.dataBreach.create.mock.calls[0]![0]!
    expect((callArg.data as any).descriptionEnc).not.toBe("plaintext desc")
    expect(safeDecryptField((callArg.data as any).descriptionEnc)).toBe("plaintext desc")
  })

  it("rejects title > 200 chars", async () => {
    await expect(dataBreachService.declare({
      severity: DataBreachSeverity.low,
      title: "x".repeat(201),
    }, 9)).rejects.toMatchObject({ field: "title" })
  })

  it("rejects description > 5000 chars", async () => {
    await expect(dataBreachService.declare({
      severity: DataBreachSeverity.low,
      title: "t",
      description: "x".repeat(5001),
    }, 9)).rejects.toBeInstanceOf(DataBreachValidationError)
  })

  it("rejects detectedAt in the future", async () => {
    await expect(dataBreachService.declare({
      severity: DataBreachSeverity.high,
      title: "t",
      detectedAt: new Date(Date.now() + 86_400_000),
    }, 9)).rejects.toMatchObject({ field: "detectedAt.future" })
  })

  it("L5 — accepts detectedAt up to 5 years ago", async () => {
    prismaMock.dataBreach.create.mockResolvedValue(baseBreach as any)
    // 4 ans en arrière : OK (rentré dans la fenêtre 5 ans).
    await expect(dataBreachService.declare({
      severity: DataBreachSeverity.high,
      title: "Historical breach 2022",
      detectedAt: new Date(Date.now() - 4 * 365 * 86_400_000),
    }, 9)).resolves.toBeTruthy()
  })

  it("L5 — rejects detectedAt > 5 years ago", async () => {
    await expect(dataBreachService.declare({
      severity: DataBreachSeverity.high,
      title: "t",
      detectedAt: new Date(Date.now() - 6 * 365 * 86_400_000),
    }, 9)).rejects.toMatchObject({ field: "detectedAt.tooOld" })
  })

  // M2 (review re-1) — heuristique PII anti-leak title.
  it("M2 — rejects title containing 15 consecutive digits (NIRPP-like)", async () => {
    await expect(dataBreachService.declare({
      severity: DataBreachSeverity.high,
      title: "Lot 185073412345678 compromis",
    }, 9)).rejects.toMatchObject({ field: "title.piiPattern" })
  })

  it("M2 — rejects title containing FR phone", async () => {
    await expect(dataBreachService.declare({
      severity: DataBreachSeverity.high,
      title: "Patient +33 6 12 34 56 78 compromis",
    }, 9)).rejects.toMatchObject({ field: "title.piiPattern" })
  })

  it("M2 — rejects title containing email", async () => {
    await expect(dataBreachService.declare({
      severity: DataBreachSeverity.high,
      title: "Account dr.dupont@cabinet.fr leaked",
    }, 9)).rejects.toMatchObject({ field: "title.piiPattern" })
  })

  it("M2 — accepts neutral technical title", async () => {
    prismaMock.dataBreach.create.mockResolvedValue(baseBreach as any)
    await expect(dataBreachService.declare({
      severity: DataBreachSeverity.high,
      title: "Incident SEC-2026-042 — fuite via webhook",
    }, 9)).resolves.toBeTruthy()
  })

  it("audit kind=data_breach.declare + severity in metadata", async () => {
    prismaMock.dataBreach.create.mockResolvedValue(baseBreach as any)
    await dataBreachService.declare({
      severity: DataBreachSeverity.critical, title: "t",
    }, 9)
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.kind).toBe("data_breach.declare")
    expect(meta.metadata.severity).toBe("critical")
  })
})

describe("cnilDeadlineHoursRemaining + cnilDeadlineExceeded (computed DTO)", () => {
  it("returns hours remaining for severity=high in draft", async () => {
    prismaMock.dataBreach.findUnique.mockResolvedValue({
      ...baseBreach,
      severity: DataBreachSeverity.high,
      status: DataBreachStatus.draft,
      detectedAt: new Date(Date.now() - 24 * 3_600_000), // 24h ago
    } as any)
    const out = await dataBreachService.getById(1, 9)
    expect(out?.cnilDeadlineHoursRemaining).toBeLessThanOrEqual(48)
    expect(out?.cnilDeadlineHoursRemaining).toBeGreaterThanOrEqual(47)
    expect(out?.cnilDeadlineExceeded).toBe(false)
  })

  // M1 (review re-1) — cap floor à 0 + flag exceeded explicite.
  it("M1 — cnilDeadlineHoursRemaining=0 + cnilDeadlineExceeded=true si dépassé", async () => {
    prismaMock.dataBreach.findUnique.mockResolvedValue({
      ...baseBreach,
      severity: DataBreachSeverity.critical,
      status: DataBreachStatus.draft,
      detectedAt: new Date(Date.now() - 100 * 3_600_000), // 100h ago > 72h
    } as any)
    const out = await dataBreachService.getById(1, 9)
    expect(out?.cnilDeadlineHoursRemaining).toBe(0)
    expect(out?.cnilDeadlineExceeded).toBe(true)
  })

  it("returns null for severity=low (no CNIL obligation)", async () => {
    prismaMock.dataBreach.findUnique.mockResolvedValue({
      ...baseBreach,
      severity: DataBreachSeverity.low,
      status: DataBreachStatus.draft,
    } as any)
    const out = await dataBreachService.getById(1, 9)
    expect(out?.cnilDeadlineHoursRemaining).toBeNull()
  })

  it("returns null once notified_cnil (timer arrêté)", async () => {
    prismaMock.dataBreach.findUnique.mockResolvedValue({
      ...baseBreach,
      severity: DataBreachSeverity.critical,
      status: DataBreachStatus.notified_cnil,
      cnilNotifiedAt: new Date(),
    } as any)
    const out = await dataBreachService.getById(1, 9)
    expect(out?.cnilDeadlineHoursRemaining).toBeNull()
  })
})

describe("FSM transitions", () => {
  it("draft → under_assessment OK", async () => {
    prismaMock.dataBreach.findUnique.mockResolvedValue(baseBreach as any)
    prismaMock.dataBreach.update.mockResolvedValue({
      ...baseBreach, status: "under_assessment",
    } as any)
    const out = await dataBreachService.transition(1, DataBreachStatus.under_assessment, 9)
    expect(out.status).toBe("under_assessment")
  })

  it("draft → notified_cnil REFUSED (must pass under_assessment first)", async () => {
    prismaMock.dataBreach.findUnique.mockResolvedValue(baseBreach as any)
    await expect(
      dataBreachService.transition(1, DataBreachStatus.notified_cnil, 9),
    ).rejects.toBeInstanceOf(DataBreachStateError)
  })

  it("under_assessment → notified_cnil OK sets cnilNotifiedAt", async () => {
    prismaMock.dataBreach.findUnique.mockResolvedValue({
      ...baseBreach, status: DataBreachStatus.under_assessment,
    } as any)
    prismaMock.dataBreach.update.mockResolvedValue({
      ...baseBreach, status: "notified_cnil", cnilNotifiedAt: new Date(),
    } as any)
    await dataBreachService.transition(1, DataBreachStatus.notified_cnil, 9)
    const updateArg = prismaMock.dataBreach.update.mock.calls[0]![0]!
    expect((updateArg.data as any).cnilNotifiedAt).toBeInstanceOf(Date)
  })

  it("notified_cnil → notified_users sets usersNotifiedAt + count", async () => {
    prismaMock.dataBreach.findUnique.mockResolvedValue({
      ...baseBreach, status: DataBreachStatus.notified_cnil,
    } as any)
    prismaMock.dataBreach.update.mockResolvedValue({
      ...baseBreach, status: "notified_users",
      usersNotifiedAt: new Date(), usersNotifiedCount: 250,
    } as any)
    await dataBreachService.transition(
      1, DataBreachStatus.notified_users, 9,
      { usersNotifiedCount: 250 },
    )
    const updateArg = prismaMock.dataBreach.update.mock.calls[0]![0]!
    expect((updateArg.data as any).usersNotifiedCount).toBe(250)
    expect((updateArg.data as any).usersNotifiedAt).toBeInstanceOf(Date)
  })

  it("closed → anything REFUSED (terminal)", async () => {
    prismaMock.dataBreach.findUnique.mockResolvedValue({
      ...baseBreach, status: DataBreachStatus.closed,
    } as any)
    await expect(
      dataBreachService.transition(1, DataBreachStatus.under_assessment, 9),
    ).rejects.toBeInstanceOf(DataBreachStateError)
  })

  it("throws NotFound when breach missing", async () => {
    prismaMock.dataBreach.findUnique.mockResolvedValue(null)
    await expect(
      dataBreachService.transition(999, DataBreachStatus.under_assessment, 9),
    ).rejects.toBeInstanceOf(DataBreachNotFoundError)
  })

  it("notified_users usersNotifiedCount negatif rejeté", async () => {
    prismaMock.dataBreach.findUnique.mockResolvedValue({
      ...baseBreach, status: DataBreachStatus.notified_cnil,
    } as any)
    await expect(
      dataBreachService.transition(
        1, DataBreachStatus.notified_users, 9,
        { usersNotifiedCount: -5 },
      ),
    ).rejects.toMatchObject({ field: "usersNotifiedCount" })
  })
})

describe("update (text fields)", () => {
  // L1 (review re-1 PR #409) — audit.metadata.fields utilise des noms
  // business (remediation), pas internes (remediationEnc).
  it("L1 — updates remediation + audit fields=[remediation] (business name)", async () => {
    prismaMock.dataBreach.update.mockResolvedValue(baseBreach as any)
    await dataBreachService.update(1, { remediation: "Reset all passwords" }, 9)
    const updateArg = prismaMock.dataBreach.update.mock.calls[0]![0]!
    expect((updateArg.data as any).remediationEnc).not.toBe("Reset all passwords")
    const meta = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(meta.metadata.fields).toEqual(["remediation"])
  })

  it("clears cnilCaseNumber when null sent", async () => {
    prismaMock.dataBreach.update.mockResolvedValue(baseBreach as any)
    await dataBreachService.update(1, { cnilCaseNumber: null }, 9)
    const updateArg = prismaMock.dataBreach.update.mock.calls[0]![0]!
    expect((updateArg.data as any).cnilCaseNumberEnc).toBeNull()
  })
})
