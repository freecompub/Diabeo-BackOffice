/**
 * Test suite: team-workflow services (Groupe 3 Batch 1, 10 US + review fixes PR #390)
 *
 * Covers (selected behaviours from 44 findings):
 *  - C1/C2/C3/C4 — route-level RBAC checks (covered in route tests, not here)
 *  - C5 — `delegationRequest.respond` audits `DELEGATION_APPROVED`/`REJECTED`
 *  - H2 — `proposalAck` propagates auditUserId
 *  - H3 — `markInvoiced` rejects double-invoicing
 *  - H4 — `proposalActualization.record` rejects source mismatch
 *  - H5 — `delegationRequest.create` rejects PHI-shaped payload + over-size
 *  - H6 — `handoffNote.listInbox` emits audit READ
 *  - H7 — `memberAbsence.listForMember` requires service membership
 *  - H8 — `delegationRequest.create` rejects toUserId not colleague
 *  - H9 — `readReceipt.markRead` requires access to underlying resource
 *  - M2 — `consultationNote.create` rejects appointment cross-patient mismatch
 *  - M3 — `memberAbsence.create` rejects member without service
 *  - M11 — self-delegation rejected
 *  - L8 — `proposalAck.respond` rejects oversized comment
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
})

describe("readReceiptService (H9 — resource access check)", () => {
  it("rejects unknown resource", async () => {
    await expect(readReceiptService.markRead("UNKNOWN", 1, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects DELEGATION_REQUEST not addressed to caller", async () => {
    prismaMock.delegationRequest.findFirst.mockResolvedValue(null)
    await expect(readReceiptService.markRead("DELEGATION_REQUEST", 1, 99))
      .rejects.toBeInstanceOf(ForbiddenError)
  })
  it("rejects HANDOFF_NOTE not addressed to caller", async () => {
    prismaMock.handoffNote.findFirst.mockResolvedValue(null)
    await expect(readReceiptService.markRead("HANDOFF_NOTE", 1, 99))
      .rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe("proposalAckService (H2 — auditUserId propagation, L8 — length)", () => {
  it("audits markRead with the caller userId, not null", async () => {
    prismaMock.adjustmentProposalAck.upsert.mockResolvedValue({
      id: 1, readAt: new Date(),
    } as any)
    await proposalAckService.markRead("abc", 7, 999 /* auditUserId */)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.userId).toBe(999)
  })
  it("rejects oversized comment in respond (L8)", async () => {
    await expect(
      proposalAckService.respond("abc", 7, { accepted: true, comment: "x".repeat(501) }, 999),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("encrypts comment + audits with caller userId", async () => {
    prismaMock.adjustmentProposalAck.upsert.mockResolvedValue({
      id: 1, accepted: true, respondedAt: new Date(),
    } as any)
    await proposalAckService.respond("abc", 7, { accepted: true, comment: "OK" }, 999)
    const upsertArgs = prismaMock.adjustmentProposalAck.upsert.mock.calls[0][0] as any
    expect(upsertArgs.create.comment).not.toBe("OK")
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.userId).toBe(999)
  })
})

describe("proposalActualizationService (H4 — overwrite guard)", () => {
  it("rejects record() when prior actualization has different verifiedVia", async () => {
    prismaMock.adjustmentProposal.findUnique.mockResolvedValue({ patientId: 7 } as any)
    prismaMock.adjustmentProposalActualization.findUnique.mockResolvedValue({
      verifiedVia: "device-sync",
    } as any)
    await expect(
      proposalActualizationService.record("abc", { verifiedVia: "manual-ps" }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("allows idempotent re-record with same verifiedVia", async () => {
    prismaMock.adjustmentProposal.findUnique.mockResolvedValue({ patientId: 7 } as any)
    prismaMock.adjustmentProposalActualization.findUnique.mockResolvedValue({
      verifiedVia: "device-sync",
    } as any)
    prismaMock.adjustmentProposalActualization.upsert.mockResolvedValue({} as any)
    await proposalActualizationService.record("abc", { verifiedVia: "device-sync" }, 9)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("UPDATE")
  })
})

describe("consultationNoteService (M2 — appointment cross-patient guard)", () => {
  it("rejects when appointment does not belong to the patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.appointment.findFirst.mockResolvedValue(null)
    await expect(
      consultationNoteService.create({
        patientId: 7, authorId: 9, appointmentId: 99, content: "examen",
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("accepts when appointment matches the patient", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.appointment.findFirst.mockResolvedValue({ id: 99 } as any)
    prismaMock.consultationNote.create.mockResolvedValue({ id: 1, createdAt: new Date() } as any)
    const out = await consultationNoteService.create({
      patientId: 7, authorId: 9, appointmentId: 99, content: "examen",
    })
    expect(out.id).toBe(1)
  })
})

describe("teleconsultActeService (H3 — double-invoicing guard)", () => {
  it("rejects invalid billing code", async () => {
    await expect(
      teleconsultActeService.create({ appointmentId: 1, billingCode: "bad code" }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects markInvoiced when already invoiced (H3)", async () => {
    prismaMock.teleconsultationActe.findUnique.mockResolvedValue({
      id: 1, invoicedAt: new Date(), billingCode: "TCG",
      appointment: { patientId: 7 },
    } as any)
    await expect(teleconsultActeService.markInvoiced(1, 9))
      .rejects.toBeInstanceOf(ValidationError)
  })
  it("invoices when not yet invoiced + audits with patientId pivot", async () => {
    prismaMock.teleconsultationActe.findUnique.mockResolvedValue({
      id: 1, invoicedAt: null, billingCode: "TCG",
      appointment: { patientId: 7 },
    } as any)
    prismaMock.teleconsultationActe.update.mockResolvedValue({
      id: 1, appointmentId: 1, billingCode: "TCG", amountCents: null, invoicedAt: new Date(),
    } as any)
    await teleconsultActeService.markInvoiced(1, 9)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.patientId).toBe(7)
  })
})

describe("delegationRequestService", () => {
  it("rejects self-delegation (M11)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    await expect(
      delegationRequestService.create({
        patientId: 7, fromUserId: 9, toUserId: 9, action: "PROPOSE",
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects toUserId not sharing a service+patient (H8)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.patientService.findFirst.mockResolvedValue(null)
    await expect(
      delegationRequestService.create({
        patientId: 7, fromUserId: 9, toUserId: 10, action: "PROPOSE",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("rejects payload looking like PHI (H5 — digits/email)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    await expect(
      delegationRequestService.create({
        patientId: 7, fromUserId: 9, toUserId: 10, action: "PROPOSE",
        payload: { note: "HbA1c 8.2 patient Dupont 1800175123456" },
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects payload exceeding 2 KB (H5)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    const oversize = { data: "x".repeat(3000) }
    await expect(
      delegationRequestService.create({
        patientId: 7, fromUserId: 9, toUserId: 10, action: "PROPOSE",
        payload: oversize,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("audits respond with DELEGATION_APPROVED + metadata.patientId (C5)", async () => {
    prismaMock.delegationRequest.findUnique.mockResolvedValue({
      id: 1, toUserId: 10, status: "pending", patientId: 7,
    } as any)
    prismaMock.delegationRequest.update.mockResolvedValue({
      id: 1, patientId: 7, status: "approved", reviewedAt: new Date(),
    } as any)
    await delegationRequestService.respond(1, 10, { status: "approved" })
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("DELEGATION_APPROVED")
    expect(audit.metadata.patientId).toBe(7)
  })

  it("audits respond with DELEGATION_REJECTED", async () => {
    prismaMock.delegationRequest.findUnique.mockResolvedValue({
      id: 1, toUserId: 10, status: "pending", patientId: 7,
    } as any)
    prismaMock.delegationRequest.update.mockResolvedValue({
      id: 1, patientId: 7, status: "rejected", reviewedAt: new Date(),
    } as any)
    await delegationRequestService.respond(1, 10, { status: "rejected", reason: "nope" })
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("DELEGATION_REJECTED")
  })
})

describe("memberAbsenceService", () => {
  it("rejects member without service (M3)", async () => {
    prismaMock.healthcareMember.findUnique.mockResolvedValue({ id: 1, serviceId: null } as any)
    await expect(
      memberAbsenceService.create(
        { memberId: 1, startDate: new Date(), endDate: new Date() }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("listForMember requires service membership (H7)", async () => {
    prismaMock.healthcareMember.findUnique.mockResolvedValue({ id: 1, serviceId: 10 } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(memberAbsenceService.listForMember(1, 99))
      .rejects.toBeInstanceOf(ForbiddenError)
  })

  it("listForMember audits READ with metadata.memberId", async () => {
    prismaMock.healthcareMember.findUnique.mockResolvedValue({ id: 1, serviceId: 10 } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 99 } as any)
    prismaMock.memberAbsence.findMany.mockResolvedValue([] as any)
    await memberAbsenceService.listForMember(1, 9)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("READ")
    expect(audit.resource).toBe("MEMBER_ABSENCE")
    expect(audit.metadata.memberId).toBe(1)
  })
})

describe("handoffNoteService", () => {
  it("rejects toUserId not colleague with patient access (H8)", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.patientService.findFirst.mockResolvedValue(null)
    await expect(
      handoffNoteService.create({
        patientId: 7, fromUserId: 9, toUserId: 10, note: "x",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it("acknowledge rejects non-recipient", async () => {
    prismaMock.handoffNote.findUnique.mockResolvedValue({
      id: 1, toUserId: 10, patientId: 7, acknowledgedAt: null,
    } as any)
    await expect(handoffNoteService.acknowledge(1, 99))
      .rejects.toBeInstanceOf(ForbiddenError)
  })

  it("listInbox audits READ (H6)", async () => {
    prismaMock.handoffNote.findMany.mockResolvedValue([] as any)
    await handoffNoteService.listInbox(10)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("READ")
    expect(audit.resource).toBe("HANDOFF_NOTE")
    expect(audit.resourceId).toBe("inbox")
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

  it("setForPatient happy path: deletes + creates new assignments", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.healthcareMember.findMany.mockResolvedValue([{ serviceId: 10 }] as any)
    prismaMock.patientGroup.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }] as any)
    prismaMock.patientGroupAssignment.deleteMany.mockResolvedValue({ count: 1 } as any)
    prismaMock.patientGroupAssignment.createMany.mockResolvedValue({ count: 2 } as any)
    const out = await patientGroupService.setForPatient(7, [1, 2], 9)
    expect(out.count).toBe(2)
  })

  it("setForPatient with empty list clears all assignments", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.patientGroupAssignment.deleteMany.mockResolvedValue({ count: 3 } as any)
    const out = await patientGroupService.setForPatient(7, [], 9)
    expect(out.count).toBe(0)
    expect(prismaMock.patientGroupAssignment.createMany).not.toHaveBeenCalled()
  })

  it("listForService rejects non-members", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue(null)
    await expect(patientGroupService.listForService(1, 9))
      .rejects.toBeInstanceOf(ForbiddenError)
  })

  it("listForService returns DTO list", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientGroup.findMany.mockResolvedValue([
      { id: 1, serviceId: 10, label: "HDJ" },
    ] as any)
    const out = await patientGroupService.listForService(10, 9)
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({ id: 1, serviceId: 10, label: "HDJ" })
  })

  it("create rejects oversized label", async () => {
    await expect(
      patientGroupService.create({ serviceId: 1, label: "x".repeat(81) }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("create happy path returns DTO", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.patientGroup.create.mockResolvedValue({
      id: 99, serviceId: 10, label: "HDJ",
    } as any)
    const g = await patientGroupService.create({ serviceId: 10, label: " HDJ " }, 9)
    expect(g.label).toBe("HDJ")
  })

  it("listForPatient audits READ (L2)", async () => {
    prismaMock.patientGroupAssignment.findMany.mockResolvedValue([] as any)
    await patientGroupService.listForPatient(7, 9)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("READ")
    expect(audit.resource).toBe("PATIENT_GROUP_ASSIGNMENT")
  })
})

describe("messageTemplateService — list + delete happy paths", () => {
  it("list returns DTO", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.messageTemplate.findMany.mockResolvedValue([
      { id: 1, serviceId: 10, title: "T", body: "B", variables: [] },
    ] as any)
    const out = await messageTemplateService.list(10, 9)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe("T")
  })

  it("create happy path with audit", async () => {
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.messageTemplate.create.mockResolvedValue({
      id: 42, serviceId: 1, title: "T", body: "B", variables: [],
    } as any)
    await messageTemplateService.create(
      { serviceId: 1, title: "T", body: "Body" }, 9,
    )
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("CREATE")
    expect(audit.resource).toBe("MESSAGE_TEMPLATE")
  })

  it("delete returns notFound when missing", async () => {
    prismaMock.messageTemplate.findUnique.mockResolvedValue(null)
    await expect(messageTemplateService.delete(99, 9))
      .rejects.toBeInstanceOf(NotFoundError)
  })

  it("delete happy path with audit", async () => {
    prismaMock.messageTemplate.findUnique.mockResolvedValue({ id: 1, serviceId: 10 } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.messageTemplate.delete.mockResolvedValue({} as any)
    const out = await messageTemplateService.delete(1, 9)
    expect(out.deleted).toBe(true)
  })

  it("create rejects oversized body", async () => {
    await expect(
      messageTemplateService.create({ serviceId: 1, title: "T", body: "x".repeat(4097) }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("teleconsultActeService — create + helpers", () => {
  it("create happy path returns DTO with patientId in audit", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ id: 1, patientId: 7 } as any)
    prismaMock.teleconsultationActe.create.mockResolvedValue({
      id: 10, appointmentId: 1, billingCode: "TCG", amountCents: 2300, invoicedAt: null,
    } as any)
    const out = await teleconsultActeService.create(
      { appointmentId: 1, billingCode: "TCG", amountCents: 2300 }, 9,
    )
    expect(out.billingCode).toBe("TCG")
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.patientId).toBe(7)
  })

  it("rejects amountCents out of range", async () => {
    await expect(
      teleconsultActeService.create({ appointmentId: 1, billingCode: "TCG", amountCents: 9_999_999 }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("getAppointmentPatientId returns null for missing appointment", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue(null)
    const r = await teleconsultActeService.getAppointmentPatientId(999)
    expect(r).toBeNull()
  })

  it("getAppointmentPatientId returns patientId on hit", async () => {
    prismaMock.appointment.findUnique.mockResolvedValue({ patientId: 7 } as any)
    const r = await teleconsultActeService.getAppointmentPatientId(1)
    expect(r).toBe(7)
  })
})

describe("delegationRequestService — listInbox + create happy path", () => {
  it("listInbox returns pending items + audits READ", async () => {
    prismaMock.delegationRequest.findMany.mockResolvedValue([
      { id: 1, patientId: 7, fromUserId: 9, action: "PROPOSE", status: "pending", createdAt: new Date() },
    ] as any)
    const out = await delegationRequestService.listInbox(10)
    expect(out).toHaveLength(1)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("READ")
    expect(audit.resourceId).toBe("inbox")
  })

  it("create happy path", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.delegationRequest.create.mockResolvedValue({
      id: 1, patientId: 7, fromUserId: 9, toUserId: 10,
      action: "PROPOSE", status: "pending", createdAt: new Date(),
    } as any)
    const out = await delegationRequestService.create({
      patientId: 7, fromUserId: 9, toUserId: 10, action: "PROPOSE",
      payload: { adjustment: "basal", value: 1.2 },
    })
    expect(out.id).toBe(1)
  })

  it("respond rejects already-reviewed (status != pending)", async () => {
    prismaMock.delegationRequest.findUnique.mockResolvedValue({
      id: 1, toUserId: 10, status: "approved", patientId: 7,
    } as any)
    await expect(
      delegationRequestService.respond(1, 10, { status: "approved" }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("respond rejects when reviewer is not the target", async () => {
    prismaMock.delegationRequest.findUnique.mockResolvedValue({
      id: 1, toUserId: 10, status: "pending", patientId: 7,
    } as any)
    await expect(
      delegationRequestService.respond(1, 99, { status: "approved" }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe("consultationNoteService — list happy path", () => {
  it("listForPatient decrypts content + audits READ", async () => {
    prismaMock.consultationNote.findMany.mockResolvedValue([
      { id: 1, patientId: 7, authorId: 9, appointmentId: null, category: null,
        content: "cipher", createdAt: new Date(), updatedAt: new Date() },
    ] as any)
    const out = await consultationNoteService.listForPatient(7, 9)
    expect(out).toHaveLength(1)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.action).toBe("READ")
    expect(audit.resource).toBe("CONSULTATION_NOTE")
  })

  it("create rejects oversized content", async () => {
    await expect(
      consultationNoteService.create({
        patientId: 7, authorId: 9, content: "x".repeat(8193),
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("proposalActualizationService — getProposalPatientId helper", () => {
  it("returns null when proposal missing", async () => {
    prismaMock.adjustmentProposal.findUnique.mockResolvedValue(null)
    const r = await proposalActualizationService.getProposalPatientId("abc")
    expect(r).toBeNull()
  })
  it("returns patientId on hit", async () => {
    prismaMock.adjustmentProposal.findUnique.mockResolvedValue({ patientId: 7 } as any)
    const r = await proposalActualizationService.getProposalPatientId("abc")
    expect(r).toBe(7)
  })

  it("record rejects when proposal missing", async () => {
    prismaMock.adjustmentProposal.findUnique.mockResolvedValue(null)
    await expect(
      proposalActualizationService.record("abc", { verifiedVia: "device-sync" }, 9),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("record device-sync sets verifiedBy=null", async () => {
    prismaMock.adjustmentProposal.findUnique.mockResolvedValue({ patientId: 7 } as any)
    prismaMock.adjustmentProposalActualization.findUnique.mockResolvedValue(null)
    prismaMock.adjustmentProposalActualization.upsert.mockResolvedValue({} as any)
    await proposalActualizationService.record("abc", { verifiedVia: "device-sync" }, 9)
    const args = prismaMock.adjustmentProposalActualization.upsert.mock.calls[0][0] as any
    expect(args.create.verifiedBy).toBeNull()
  })

  it("record manual-ps sets verifiedBy=auditUserId", async () => {
    prismaMock.adjustmentProposal.findUnique.mockResolvedValue({ patientId: 7 } as any)
    prismaMock.adjustmentProposalActualization.findUnique.mockResolvedValue(null)
    prismaMock.adjustmentProposalActualization.upsert.mockResolvedValue({} as any)
    await proposalActualizationService.record("abc", { verifiedVia: "manual-ps" }, 9)
    const args = prismaMock.adjustmentProposalActualization.upsert.mock.calls[0][0] as any
    expect(args.create.verifiedBy).toBe(9)
  })
})

describe("memberAbsenceService — date range + create happy path", () => {
  it("rejects endDate < startDate", async () => {
    await expect(
      memberAbsenceService.create(
        { memberId: 1, startDate: new Date("2026-06-10"), endDate: new Date("2026-06-01") },
        9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects when member not found", async () => {
    prismaMock.healthcareMember.findUnique.mockResolvedValue(null)
    await expect(
      memberAbsenceService.create(
        { memberId: 99, startDate: new Date(), endDate: new Date() }, 9,
      ),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it("happy path returns row with audit metadata", async () => {
    prismaMock.healthcareMember.findUnique.mockResolvedValue({ id: 1, serviceId: 10 } as any)
    prismaMock.healthcareMember.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.memberAbsence.create.mockResolvedValue({ id: 1 } as any)
    await memberAbsenceService.create(
      { memberId: 1, startDate: new Date(), endDate: new Date() }, 9,
    )
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.serviceId).toBe(10)
  })
})

describe("handoffNoteService — create + acknowledge happy paths", () => {
  it("create happy path encrypts note", async () => {
    prismaMock.patient.findFirst.mockResolvedValue({ id: 7 } as any)
    prismaMock.patientService.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.handoffNote.create.mockResolvedValue({ id: 1, createdAt: new Date() } as any)
    await handoffNoteService.create({
      patientId: 7, fromUserId: 9, toUserId: 10, note: "Surveiller hypo",
    })
    const args = prismaMock.handoffNote.create.mock.calls[0][0] as any
    expect(args.data.note).not.toContain("Surveiller")
  })

  it("acknowledge happy path", async () => {
    prismaMock.handoffNote.findUnique.mockResolvedValue({
      id: 1, toUserId: 10, patientId: 7, acknowledgedAt: null,
    } as any)
    prismaMock.handoffNote.update.mockResolvedValue({
      acknowledgedAt: new Date(),
    } as any)
    const out = await handoffNoteService.acknowledge(1, 10)
    expect(out.acknowledgedAt).toBeInstanceOf(Date)
  })

  it("acknowledge idempotent (already acknowledged)", async () => {
    const prev = new Date()
    prismaMock.handoffNote.findUnique.mockResolvedValue({
      id: 1, toUserId: 10, patientId: 7, acknowledgedAt: prev,
    } as any)
    const out = await handoffNoteService.acknowledge(1, 10)
    expect(out.acknowledgedAt).toBe(prev)
    expect(prismaMock.handoffNote.update).not.toHaveBeenCalled()
  })
})

describe("readReceiptService — happy path on ANNOUNCEMENT", () => {
  it("marks read and audits", async () => {
    prismaMock.announcement.findFirst.mockResolvedValue({ id: 1 } as any)
    prismaMock.readReceipt.upsert.mockResolvedValue({ id: 1, readAt: new Date() } as any)
    const r = await readReceiptService.markRead("ANNOUNCEMENT", 1, 9)
    expect(r.readAt).toBeInstanceOf(Date)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.resource).toBe("READ_RECEIPT")
  })

  it("rejects ANNOUNCEMENT that doesn't exist", async () => {
    prismaMock.announcement.findFirst.mockResolvedValue(null)
    await expect(readReceiptService.markRead("ANNOUNCEMENT", 999, 9))
      .rejects.toBeInstanceOf(NotFoundError)
  })
})
