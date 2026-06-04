/**
 * Test suite: patientService.createWithNewUser — new-patient provisioning
 *
 * Clinical / security behavior tested:
 * - Creating a patient from the /patients/new wizard provisions a NEW User
 *   account (no pre-existing user): the email is encrypted (AES-256-GCM, never
 *   stored plaintext) and an emailHmac is computed for unique lookup; the
 *   firstname/lastname are encrypted; a random throwaway password is hashed
 *   (the patient sets a real one via the invitation email).
 * - The account is created with role VIEWER and the onboarding flags
 *   (needPasswordUpdate / needOnboarding) so the patient is forced through the
 *   set-password + onboarding flow on first login.
 * - PatientMedicalData.yearDiag is created only when provided.
 * - An invitation (set-password) VerificationToken is persisted, keyed by the
 *   emailHmac, and its plaintext token is returned to the caller for emailing.
 *
 * Associated risks:
 * - Storing the email/names in plaintext would expose PII if the DB is
 *   compromised (HDS / GDPR Article 9 violation).
 * - A weak or fixed password would let anyone log into the new account before
 *   the patient sets their own — must be random + bcrypt-hashed.
 * - Duplicate emails must be rejected (friendly pre-check + DB unique
 *   constraint) — a race must surface as `emailExists`, never a 500.
 *
 * Edge cases:
 * - Email already in use (pre-check) → PatientCreationError("emailExists").
 * - Unique-constraint race (P2002) → mapped to PatientCreationError.
 * - yearDiag absent → PatientMedicalData NOT created.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { patientService, PatientCreationError } from "@/lib/services/patient.service"
import { Prisma } from "@prisma/client"

interface Captured {
  user?: any
  patient?: any
  medical?: any
  vToken?: any
  vTokenDeleted?: any
  audits: any[]
}

function mockCreateTx(): Captured {
  const cap: Captured = { audits: [] }
  prismaMock.$transaction.mockImplementation(async (fn: any) => {
    const tx = {
      user: {
        create: vi.fn(async (args: any) => {
          cap.user = args
          return { id: 77 }
        }),
      },
      patient: {
        create: vi.fn(async (args: any) => {
          cap.patient = args
          return { id: 42, pathology: args.data.pathology }
        }),
      },
      patientMedicalData: {
        create: vi.fn(async (args: any) => {
          cap.medical = args
          return {}
        }),
      },
      verificationToken: {
        deleteMany: vi.fn(async (args: any) => {
          cap.vTokenDeleted = args
          return { count: 0 }
        }),
        create: vi.fn(async (args: any) => {
          cap.vToken = args
          return {}
        }),
      },
      auditLog: {
        create: vi.fn(async (args: any) => {
          cap.audits.push(args.data)
          return {}
        }),
      },
    }
    return fn(tx)
  })
  return cap
}

describe("patientService.createWithNewUser", () => {
  beforeEach(() => {
    // Default: email not already used.
    prismaMock.user.findUnique.mockResolvedValue(null as any)
  })

  it("provisions user + patient and returns ids + invitation token", async () => {
    mockCreateTx()

    const res = await patientService.createWithNewUser(
      {
        email: "New.Patient@Example.com",
        firstName: "Jean",
        lastName: "Dupont",
        sex: "M",
        birthday: "1990-05-15",
        pathology: "DT1" as any,
        yearDiag: 2015,
      },
      1,
    )

    expect(res).toMatchObject({ id: 42, userId: 77, pathology: "DT1" })
    expect(res.resetToken).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("encrypts email + names and never stores plaintext", async () => {
    const cap = mockCreateTx()

    await patientService.createWithNewUser(
      {
        email: "secret@example.com",
        firstName: "Jean",
        lastName: "Dupont",
        pathology: "DT1" as any,
      },
      1,
    )

    expect(cap.user.data.email).not.toBe("secret@example.com")
    expect(cap.user.data.firstname).not.toBe("Jean")
    expect(cap.user.data.lastname).not.toBe("Dupont")
    // emailHmac is a 64-hex SHA-256 digest, derived from the lowercased email.
    expect(cap.user.data.emailHmac).toMatch(/^[0-9a-f]{64}$/)
    // Throwaway password is bcrypt-hashed (cost 12), not the plaintext.
    expect(cap.user.data.passwordHash).toMatch(/^\$2[aby]\$12\$/)
  })

  it("creates the account as VIEWER with onboarding flags", async () => {
    const cap = mockCreateTx()

    await patientService.createWithNewUser(
      { email: "v@example.com", firstName: "A", lastName: "B", pathology: "DT2" as any },
      1,
    )

    expect(cap.user.data.role).toBe("VIEWER")
    expect(cap.user.data.status).toBe("active")
    expect(cap.user.data.needPasswordUpdate).toBe(true)
    expect(cap.user.data.needOnboarding).toBe(true)
  })

  it("persists an invitation token keyed by emailHmac equal to the returned token", async () => {
    const cap = mockCreateTx()

    const res = await patientService.createWithNewUser(
      { email: "inv@example.com", firstName: "A", lastName: "B", pathology: "GD" as any },
      1,
    )

    expect(cap.vTokenDeleted.where.identifier).toBe(cap.user.data.emailHmac)
    expect(cap.vToken.data.identifier).toBe(cap.user.data.emailHmac)
    expect(cap.vToken.data.token).toBe(res.resetToken)
    expect(cap.vToken.data.expires).toBeInstanceOf(Date)
  })

  it("writes CREATE USER + CREATE PATIENT audit logs with patientId pivot", async () => {
    const cap = mockCreateTx()

    await patientService.createWithNewUser(
      { email: "audit@example.com", firstName: "A", lastName: "B", pathology: "DT1" as any },
      9,
    )

    const userAudit = cap.audits.find((a) => a.resource === "USER")
    const patientAudit = cap.audits.find((a) => a.resource === "PATIENT")
    expect(userAudit).toMatchObject({ action: "CREATE", userId: 9 })
    expect(userAudit.metadata).toMatchObject({ patientId: 42 })
    expect(patientAudit).toMatchObject({ action: "CREATE", userId: 9 })
    expect(patientAudit.metadata).toMatchObject({ patientId: 42 })
  })

  it("creates PatientMedicalData only when yearDiag is provided", async () => {
    const cap = mockCreateTx()

    await patientService.createWithNewUser(
      { email: "noyear@example.com", firstName: "A", lastName: "B", pathology: "DT1" as any },
      1,
    )

    expect(cap.medical).toBeUndefined()
  })

  it("throws emailExists when the email is already in use (pre-check)", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 5 } as any)

    await expect(
      patientService.createWithNewUser(
        { email: "dup@example.com", firstName: "A", lastName: "B", pathology: "DT2" as any },
        1,
      ),
    ).rejects.toBeInstanceOf(PatientCreationError)
  })

  it("maps a P2002 race on email_hmac to emailExists", async () => {
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { target: ["email_hmac"] },
      } as any),
    )

    await expect(
      patientService.createWithNewUser(
        { email: "race@example.com", firstName: "A", lastName: "B", pathology: "GD" as any },
        1,
      ),
    ).rejects.toMatchObject({ code: "emailExists" })
  })

  it("re-throws a P2002 on a DIFFERENT constraint (no false emailExists)", async () => {
    // e.g. an astronomically unlikely VerificationToken UUID collision must NOT
    // be reported to the user as "email already in use".
    prismaMock.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { target: ["token"] },
      } as any),
    )

    await expect(
      patientService.createWithNewUser(
        { email: "other@example.com", firstName: "A", lastName: "B", pathology: "DT1" as any },
        1,
      ),
    ).rejects.toMatchObject({ code: "P2002" })

    await expect(
      patientService.createWithNewUser(
        { email: "other@example.com", firstName: "A", lastName: "B", pathology: "DT1" as any },
        1,
      ),
    ).rejects.not.toBeInstanceOf(PatientCreationError)
  })
})
