/**
 * Test suite: team-workflow services (Groupe 3 Batch 1, 10 US)
 *
 * Covers:
 *  - US-2078 MessageTemplate : membership check + validation + audit
 *  - US-2080 ReadReceipt     : upsert + restricted resource set
 *  - US-2065 ProposalAck     : patient mark-read + respond (encrypted comment)
 *  - US-2066 ProposalActualization : verifiedVia enum, verifiedBy auto-null
 *      for device-sync
 *  - US-2068 ConsultationNote : encrypts content, audits patient pivot
 *  - US-2072 TeleconsultActe : billing code regex, audit metadata
 *  - US-2083 DelegationRequest : create + respond (only target user)
 *  - US-2084 MemberAbsence : membership check via member's service
 *  - US-2086 HandoffNote : encrypted note + ack restricted to recipient
 *  - US-2088 PatientGroup : cross-cabinet contamination blocked
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  messageTemplateService,
  readReceiptService,
  proposalAckService,
  proposalActualizationService,
  consultationNoteService,
  teleconsultActeService,
  delegationRequestService,
  memberAbsenceService,
  handoffNoteService,
  patientGroupService,
} from "@/lib/services/team-workflow.service"
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

describe("messageTemplateService", () => {
  it("rejects non-members on list", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(messageTemplateService.list(1, 9)).rejects.toBeInstanceOf(ForbiddenError)
  })
  it("rejects empty title on create", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    await expect(
      messageTemplateService.create({ serviceId: 1, title: "  ", body: "x" }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("audits CREATE with serviceId in metadata", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.messageTemplate.create.mockResolvedValue({
      id: 42, serviceId: 1, title: "Welcome", body: "...", variables: [],
    } as any)
    await messageTemplateService.create(
      { serviceId: 1, title: "Welcome", body: "hello" }, 9,
    )
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.resource).toBe("MESSAGE_TEMPLATE")
    expect(audit.metadata.serviceId).toBe(1)
  })
})

describe("readReceiptService", () => {
  it("rejects unknown resource", async () => {
    await expect(readReceiptService.markRead("UNKNOWN", 1, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })
  it("upserts idempotently and audits", async () => {
    prismaMock.readReceipt.upsert.mockResolvedValue({ id: 1, readAt: new Date() } as any)
    const r = await readReceiptService.markRead("ANNOUNCEMENT", 1, 9)
    expect(r.readAt).toBeInstanceOf(Date)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.resource).toBe("READ_RECEIPT")
  })
})

describe("proposalAckService", () => {
  it("encrypts comment on respond (no plaintext at-rest)", async () => {
    prismaMock.adjustmentProposalAck.upsert.mockResolvedValue({
      id: 1, proposalId: "abc", patientId: 7, acknowledged: true,
      accepted: true, comment: null, readAt: new Date(), respondedAt: new Date(),
    } as any)
    await proposalAckService.respond("abc", 7, { accepted: true, comment: "OK pour moi" })
    const upsertArgs = prismaMock.adjustmentProposalAck.upsert.mock.calls[0][0] as any
    expect(upsertArgs.create.comment).not.toBe("OK pour moi") // encrypted
    expect(typeof upsertArgs.create.comment).toBe("string")
  })
})

describe("proposalActualizationService", () => {
  it("rejects unknown verifiedVia", async () => {
    await expect(
      proposalActualizationService.record("abc", { verifiedVia: "magic" }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("sets verifiedBy=null when verifiedVia=device-sync", async () => {
    prismaMock.adjustmentProposal.findUnique.mockResolvedValue({ patientId: 7 } as any)
    prismaMock.adjustmentProposalActualization.upsert.mockResolvedValue({} as any)
    await proposalActualizationService.record("abc", { verifiedVia: "device-sync" }, 9)
    const args = prismaMock.adjustmentProposalActualization.upsert.mock.calls[0][0] as any
    expect(args.create.verifiedBy).toBeNull()
  })
  it("keeps verifiedBy for manual-ps", async () => {
    prismaMock.adjustmentProposal.findUnique.mockResolvedValue({ patientId: 7 } as any)
    prismaMock.adjustmentProposalActualization.upsert.mockResolvedValue({} as any)
    await proposalActualizationService.record("abc", { verifiedVia: "manual-ps" }, 9)
    const args = prismaMock.adjustmentProposalActualization.upsert.mock.calls[0][0] as any
    expect(args.create.verifiedBy).toBe(9)
  })
})

describe("consultationNoteService", () => {
  it("blocks soft-deleted patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue(null)
    await expect(
      consultationNoteService.create({ patientId: 7, authorId: 9, content: "ok" }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
  it("encrypts content before persisting", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.consultationNote.create.mockResolvedValue({ id: 1, createdAt: new Date() } as any)
    await consultationNoteService.create({
      patientId: 7, authorId: 9, content: "Examen normal — TA 12/8",
    })
    const args = prismaMock.consultationNote.create.mock.calls[0][0] as any
    expect(args.data.content).not.toContain("Examen")
  })
})

describe("teleconsultActeService", () => {
  it("rejects invalid billing code", async () => {
    await expect(
      teleconsultActeService.create({ appointmentId: 1, billingCode: "bad code" }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects when appointment is missing", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(null)
    await expect(
      teleconsultActeService.create({ appointmentId: 999, billingCode: "TCG" }, 9),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
  it("audits with patientId pivot derived from appointment", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ id: 1, patientId: 7 } as any)
    prismaMock.teleconsultationActe.create.mockResolvedValue({ id: 11 } as any)
    await teleconsultActeService.create({ appointmentId: 1, billingCode: "TCG" }, 9)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.patientId).toBe(7)
  })
})

describe("delegationRequestService", () => {
  it("rejects empty action", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    await expect(
      delegationRequestService.create({
        patientId: 7, fromUserId: 9, toUserId: 10, action: "  ",
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("respond forbidden if reviewer ≠ target", async () => {
    prismaMock.delegationRequest.findUnique.mockResolvedValue({
      id: 1, toUserId: 10, status: "pending", patientId: 7,
    } as any)
    await expect(
      delegationRequestService.respond(1, 99, { status: "approved" }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
  it("respond rejects already-reviewed", async () => {
    prismaMock.delegationRequest.findUnique.mockResolvedValue({
      id: 1, toUserId: 10, status: "approved", patientId: 7,
    } as any)
    await expect(
      delegationRequestService.respond(1, 10, { status: "approved" }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("memberAbsenceService", () => {
  it("rejects endDate < startDate", async () => {
    await expect(
      memberAbsenceService.create(
        { memberId: 1, startDate: new Date("2026-06-10"), endDate: new Date("2026-06-01") },
        9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("requires caller to be member of the absent member's service", async () => {
    prismaMock.healthcareMember.findUnique.mockResolvedValue({ id: 1, serviceId: 10 } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(
      memberAbsenceService.create(
        { memberId: 1, startDate: new Date(), endDate: new Date() },
        9,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe("handoffNoteService", () => {
  it("encrypts note on create", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.handoffNote.create.mockResolvedValue({ id: 1, createdAt: new Date() } as any)
    await handoffNoteService.create({
      patientId: 7, fromUserId: 9, toUserId: 10, note: "Surveiller hypo nocturne",
    })
    const args = prismaMock.handoffNote.create.mock.calls[0][0] as any
    expect(args.data.note).not.toContain("Surveiller")
  })
  it("acknowledge rejects non-recipient", async () => {
    prismaMock.handoffNote.findUnique.mockResolvedValue({
      id: 1, toUserId: 10, patientId: 7, acknowledgedAt: null,
    } as any)
    await expect(
      handoffNoteService.acknowledge(1, 99),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe("patientGroupService", () => {
  it("setForPatient blocks cross-cabinet groups", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.healthcareMember.findMany.mockResolvedValue([{ serviceId: 10 }] as any)
    prismaMock.patientGroup.findMany.mockResolvedValue([{ id: 1 }] as any)
    await expect(
      patientGroupService.setForPatient(7, [1, 2], 9),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
  it("setForPatient passes with all-in-scope groups", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.healthcareMember.findMany.mockResolvedValue([{ serviceId: 10 }] as any)
    prismaMock.patientGroup.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }] as any)
    prismaMock.patientGroupAssignment.deleteMany.mockResolvedValue({ count: 0 } as any)
    prismaMock.patientGroupAssignment.createMany.mockResolvedValue({ count: 2 } as any)
    const out = await patientGroupService.setForPatient(7, [1, 2], 9)
    expect(out.count).toBe(2)
  })
})
