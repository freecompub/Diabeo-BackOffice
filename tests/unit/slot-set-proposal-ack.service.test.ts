/**
 * US-2663 (S5/c4) — Service : accusé / actualisation patient sur une SlotSetProposal
 * (proposition GROUPÉE). Port grouped-only de `proposalAck`/`proposalActualization` (US-2065/2066).
 *
 * Comportement clinique / sécurité testé :
 *  - Accusé (`markRead`/`respond`) : l'auditUserId (H2) est bien celui de l'appelant (jamais null),
 *    le commentaire libre patient est CHIFFRÉ avant persistance (AES-256-GCM, jamais en clair),
 *    et un commentaire > 500 car. est rejeté (garde L8 défensive côté service).
 *  - Actualisation (`record`) : garde H4 anti-écrasement — refus si une actualisation antérieure
 *    a une source (`verifiedVia`) DIFFÉRENTE (une décision de dose déjà appliquée ne doit pas être
 *    réécrite silencieusement par un autre canal), re-record idempotent autorisé pour la MÊME source,
 *    `verifiedBy` traçabilité (null pour `device-sync` automatique, sinon soignant), NotFound si la
 *    proposition n'existe pas (fail-closed avant toute écriture).
 *
 * Ne teste PAS iOS. Ce fichier est neuf et ne modifie pas les tests par-valeur existants.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  slotSetProposalAckService,
  slotSetProposalActualizationService,
} from "@/lib/services/team-workflow.service"
import {
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as never)
  // La transaction Serializable exécute directement le callback sur le mock.
  prismaMock.$transaction.mockImplementation(
    ((fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock)) as never,
  )
})

describe("slotSetProposalAckService.markRead (H2 — auditUserId propagation)", () => {
  it("upsert idempotent + audit READ PROPOSAL_ACK avec le userId appelant et model=slotSet", async () => {
    prismaMock.slotSetProposalAck.upsert.mockResolvedValue({
      id: 1, readAt: new Date("2026-07-14T00:00:00Z"),
    } as never)

    const ack = await slotSetProposalAckService.markRead("set-1", 7, 999)

    expect(ack.readAt).toBeInstanceOf(Date)
    // La clé d'upsert cible bien la SlotSetProposal (1:1 via slotSetProposalId @unique).
    const upsertArgs = prismaMock.slotSetProposalAck.upsert.mock.calls[0][0]
    expect(upsertArgs.where).toEqual({ slotSetProposalId: "set-1" })
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as unknown as {
      userId: number; action: string; resource: string; resourceId: string
      metadata: { model: string; patientId: number; kind: string }
    }
    expect(audit.userId).toBe(999)
    expect(audit.action).toBe("READ")
    expect(audit.resource).toBe("PROPOSAL_ACK")
    expect(audit.resourceId).toBe("set-1")
    expect(audit.metadata.model).toBe("slotSet")
    expect(audit.metadata.patientId).toBe(7)
  })
})

describe("slotSetProposalAckService.respond (chiffrement commentaire + L8)", () => {
  it("rejette un commentaire > 500 caractères (Validationcomment, jamais persisté)", async () => {
    await expect(
      slotSetProposalAckService.respond("set-1", 7, { accepted: true, comment: "x".repeat(501) }, 999),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(prismaMock.slotSetProposalAck.upsert).not.toHaveBeenCalled()
  })

  it("acceptation : chiffre le commentaire (jamais en clair) + audit UPDATE avec accepted=true", async () => {
    prismaMock.slotSetProposalAck.upsert.mockResolvedValue({
      id: 1, accepted: true, respondedAt: new Date(),
    } as never)

    const ack = await slotSetProposalAckService.respond("set-1", 7, { accepted: true, comment: "OK pour moi" }, 999)

    expect(ack.accepted).toBe(true)
    const upsertArgs = prismaMock.slotSetProposalAck.upsert.mock.calls[0][0] as {
      create: { comment: string | null; accepted: boolean }
    }
    // Le commentaire est chiffré (base64) — jamais la valeur en clair.
    expect(upsertArgs.create.comment).not.toBe("OK pour moi")
    expect(upsertArgs.create.comment).toBeTypeOf("string")
    expect(upsertArgs.create.accepted).toBe(true)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as unknown as {
      userId: number; action: string; metadata: { accepted: boolean; model: string }
    }
    expect(audit.userId).toBe(999)
    expect(audit.action).toBe("UPDATE")
    expect(audit.metadata.accepted).toBe(true)
    expect(audit.metadata.model).toBe("slotSet")
  })

  it("rejet sans commentaire : comment=null persisté + audit accepted=false", async () => {
    prismaMock.slotSetProposalAck.upsert.mockResolvedValue({
      id: 1, accepted: false, respondedAt: new Date(),
    } as never)

    await slotSetProposalAckService.respond("set-1", 7, { accepted: false }, 999)

    const upsertArgs = prismaMock.slotSetProposalAck.upsert.mock.calls[0][0] as {
      create: { comment: string | null }
    }
    expect(upsertArgs.create.comment).toBeNull()
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as unknown as {
      metadata: { accepted: boolean }
    }
    expect(audit.metadata.accepted).toBe(false)
  })
})

describe("slotSetProposalActualizationService.record (H4 — garde anti-écrasement)", () => {
  it("crée l'actualisation quand aucune n'existe (manual-ps → verifiedBy=auditUserId, action CREATE)", async () => {
    prismaMock.slotSetProposal.findUnique.mockResolvedValue({ patientId: 7 } as never)
    prismaMock.slotSetProposalActualization.findUnique.mockResolvedValue(null)
    prismaMock.slotSetProposalActualization.upsert.mockResolvedValue({} as never)

    await slotSetProposalActualizationService.record("set-1", { verifiedVia: "manual-ps" }, 9)

    const args = prismaMock.slotSetProposalActualization.upsert.mock.calls[0][0] as {
      create: { verifiedBy: number | null; verifiedVia: string }
    }
    expect(args.create.verifiedBy).toBe(9)
    expect(args.create.verifiedVia).toBe("manual-ps")
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as unknown as {
      action: string; resource: string; metadata: { model: string; patientId: number }
    }
    expect(audit.action).toBe("CREATE")
    expect(audit.resource).toBe("PROPOSAL_ACTUALIZATION")
    expect(audit.metadata.model).toBe("slotSet")
    expect(audit.metadata.patientId).toBe(7)
  })

  it("device-sync automatique → verifiedBy=null (traçabilité : pas d'auteur humain)", async () => {
    prismaMock.slotSetProposal.findUnique.mockResolvedValue({ patientId: 7 } as never)
    prismaMock.slotSetProposalActualization.findUnique.mockResolvedValue(null)
    prismaMock.slotSetProposalActualization.upsert.mockResolvedValue({} as never)

    await slotSetProposalActualizationService.record("set-1", { verifiedVia: "device-sync" }, 9)

    const args = prismaMock.slotSetProposalActualization.upsert.mock.calls[0][0] as {
      create: { verifiedBy: number | null }
    }
    expect(args.create.verifiedBy).toBeNull()
  })

  it("re-record avec la MÊME source (device-sync idempotent) → OK, action UPDATE", async () => {
    prismaMock.slotSetProposal.findUnique.mockResolvedValue({ patientId: 7 } as never)
    prismaMock.slotSetProposalActualization.findUnique.mockResolvedValue({
      verifiedVia: "device-sync",
    } as never)
    prismaMock.slotSetProposalActualization.upsert.mockResolvedValue({} as never)

    await slotSetProposalActualizationService.record("set-1", { verifiedVia: "device-sync" }, 9)

    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as unknown as { action: string }
    expect(audit.action).toBe("UPDATE")
  })

  it("H4 — refuse le re-record si la source diffère (alreadyActualized, aucune écriture)", async () => {
    prismaMock.slotSetProposal.findUnique.mockResolvedValue({ patientId: 7 } as never)
    prismaMock.slotSetProposalActualization.findUnique.mockResolvedValue({
      verifiedVia: "device-sync",
    } as never)

    await expect(
      slotSetProposalActualizationService.record("set-1", { verifiedVia: "manual-ps" }, 9),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(prismaMock.slotSetProposalActualization.upsert).not.toHaveBeenCalled()
  })

  it("fail-closed : NotFound si la SlotSetProposal n'existe pas (jamais d'actualisation orpheline)", async () => {
    prismaMock.slotSetProposal.findUnique.mockResolvedValue(null)

    await expect(
      slotSetProposalActualizationService.record("set-x", { verifiedVia: "device-sync" }, 9),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(prismaMock.slotSetProposalActualization.upsert).not.toHaveBeenCalled()
  })
})

describe("slotSetProposalActualizationService.getProposalPatientId (RBAC helper)", () => {
  it("renvoie null quand la proposition est absente", async () => {
    prismaMock.slotSetProposal.findUnique.mockResolvedValue(null)
    const r = await slotSetProposalActualizationService.getProposalPatientId("set-x")
    expect(r).toBeNull()
  })

  it("renvoie le patientId propriétaire sur hit", async () => {
    prismaMock.slotSetProposal.findUnique.mockResolvedValue({ patientId: 7 } as never)
    const r = await slotSetProposalActualizationService.getProposalPatientId("set-1")
    expect(r).toBe(7)
  })
})
