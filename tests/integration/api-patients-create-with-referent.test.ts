/**
 * Integration test — POST /api/patients creates a PatientReferent linking the
 * new patient to the creating professional's HealthcareMember.
 *
 * The test is **self-contained**: a beforeAll fixture creates an ephemeral User
 * + HealthcareService + HealthcareMember if no suitable actor exists in the
 * database, and afterAll tears them down. No reliance on `pnpm prisma db seed`.
 *
 * Only the DATABASE_URL must point at a real, migrated Postgres
 * (tests/helpers/setup.ts handles this; CI must set it explicitly).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { randomBytes } from "crypto"
import { hash as bcryptHash } from "bcryptjs"
import { prisma } from "@/lib/db/client"
import { hmacEmail } from "@/lib/crypto/hmac"
import { encryptField } from "@/lib/crypto/fields"

const TEST_EMAIL = "new.patient@example.com"

/** Discover a User already linked to a HealthcareMember (skip the fixture if so). */
async function findExistingActorUserId(): Promise<number | null> {
  const member = await prisma.healthcareMember.findFirst({
    where: { userId: { not: null } },
    select: { userId: true },
  })
  return member?.userId ?? null
}

/**
 * Create an ephemeral actor: User + HealthcareService + HealthcareMember
 * linked together. Returns the IDs so afterAll can delete them.
 */
async function createActorFixture() {
  const fixtureEmail = `actor-${randomBytes(8).toString("hex")}@test.local`
  const user = await prisma.user.create({
    data: {
      email: encryptField(fixtureEmail),
      emailHmac: hmacEmail(fixtureEmail),
      // cost 10 — test fixture only, not a security baseline. Prod uses 12 (cf. patient.service.ts).
    passwordHash: await bcryptHash(randomBytes(32).toString("base64url"), 10),
      firstname: encryptField("Test"),
      lastname: encryptField("Actor"),
      role: "NURSE",
      status: "active",
      language: "fr",
    },
    select: { id: true },
  })
  const service = await prisma.healthcareService.create({
    data: { name: `test-service-${randomBytes(4).toString("hex")}` },
    select: { id: true },
  })
  const member = await prisma.healthcareMember.create({
    data: { name: "Test Member", serviceId: service.id, userId: user.id },
    select: { id: true },
  })
  return { userId: user.id, memberId: member.id, serviceId: service.id }
}

let actorUserId: number | null = null
let createdFixture: { userId: number; memberId: number; serviceId: number } | null = null
let postgresReachable = false

/**
 * Connectivity probe — the CI `test-unit` job intentionally runs without
 * Postgres (most integration tests in this repo mock prisma). This test
 * hits the REAL database to assert transaction atomicity, so we self-skip
 * gracefully when Postgres isn't listening rather than throwing a noisy
 * `ECONNREFUSED` across N test cases.
 */
async function isPostgresReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}

/**
 * Clean up test artefacts by deterministic HMAC (encrypted columns can't be
 * text-matched).
 *
 * MAINTAIN: keep this list in sync with `deletion.service.ts` when adding new
 * FK-cascade tables to `User` or `Patient` — otherwise teardown will throw on
 * `prisma.user.delete()` and break every test in this file.
 *
 * NOTE: `audit_logs` rows are NOT purged — the table is immutable by PG trigger
 * (`audit_immutability.sql`). Each test run leaves ~4 audit rows behind
 * (USER + PATIENT + REFERENT creates + VerificationToken events). This is
 * acceptable in dev; production audit retention is handled by US-2153.
 */
async function purgeTestUser() {
  const emailHmac = hmacEmail(TEST_EMAIL)
  const user = await prisma.user.findUnique({ where: { emailHmac }, select: { id: true } })
  if (!user) return
  const patient = await prisma.patient.findFirst({
    where: { userId: user.id },
    select: { id: true },
  })
  if (patient) {
    await prisma.patientReferent.deleteMany({ where: { patientId: patient.id } })
    await prisma.patientMedicalData.deleteMany({ where: { patientId: patient.id } })
    await prisma.patient.delete({ where: { id: patient.id } })
  }
  await prisma.verificationToken.deleteMany({ where: { identifier: emailHmac } })
  await prisma.user.delete({ where: { id: user.id } })
}

vi.mock("@/lib/services/email.service", () => ({
  emailService: { sendPasswordReset: vi.fn().mockResolvedValue({ id: "email-1" }) },
}))

vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>()
  return {
    ...actual,
    // requireRole/requireAuth resolve to the dynamic actor discovered at beforeAll.
    requireRole: (_req: NextRequest, role: string) => ({
      id: actorUserId ?? 0,
      role: role as "NURSE",
    }),
    requireAuth: (_req: NextRequest) => ({ id: actorUserId ?? 0, role: "NURSE" as const }),
    checkRateLimit: vi.fn().mockResolvedValue({ blocked: false }),
    recordFailedAttempt: vi.fn().mockResolvedValue(undefined),
  }
})

const { POST } = await import("@/app/api/patients/route")

const VALID_BODY = {
  email: TEST_EMAIL,
  firstName: "Jean",
  lastName: "Dupont",
  sex: "M",
  birthday: "1990-05-15",
  pathology: "DT1",
  yearDiag: 2015,
}

function makeReq(body: unknown): NextRequest {
  const headers = new Headers()
  headers.set("x-user-id", String(actorUserId ?? 0))
  headers.set("x-user-role", "NURSE")
  headers.set("content-type", "application/json")
  headers.set("x-requested-with", "XMLHttpRequest")
  return new NextRequest(new URL("/api/patients", "http://test.local"), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
}

beforeAll(async () => {
  postgresReachable = await isPostgresReachable()
  if (!postgresReachable) return
  // Try to reuse an existing actor (avoid polluting the DB if seed already
  // provides one). If none, create an ephemeral fixture for the suite.
  actorUserId = await findExistingActorUserId()
  if (actorUserId === null) {
    createdFixture = await createActorFixture()
    actorUserId = createdFixture.userId
  }
})

afterAll(async () => {
  if (!postgresReachable || !createdFixture) return
  await prisma.patientReferent.deleteMany({ where: { proId: createdFixture.memberId } })
  await prisma.healthcareMember.delete({ where: { id: createdFixture.memberId } }).catch(() => {})
  await prisma.healthcareService
    .delete({ where: { id: createdFixture.serviceId } })
    .catch(() => {})
  await prisma.user.delete({ where: { id: createdFixture.userId } }).catch(() => {})
})

beforeEach(async () => {
  vi.clearAllMocks()
  if (postgresReachable) await purgeTestUser()
})

afterEach(async () => {
  if (postgresReachable) await purgeTestUser()
})

describe("POST /api/patients — PatientReferent creation", () => {
  it("creates a patient and links a PatientReferent to the creating pro", async () => {
    if (!postgresReachable) {
      console.warn("[skip] Postgres not reachable — integration test requires a real DB.")
      return
    }
    if (actorUserId === null) throw new Error("beforeAll failed to resolve actorUserId")

    const res = await POST(makeReq(VALID_BODY))
    expect(res.status).toBe(201)
    const json = await res.json()
    const patientId = json.id as number
    expect(typeof patientId).toBe("number")

    // Patient row exists with the requested pathology.
    const patient = await prisma.patient.findUnique({ where: { id: patientId } })
    expect(patient).not.toBeNull()
    expect(patient?.pathology).toBe("DT1")

    // PatientReferent row exists pointing to the creator's HealthcareMember.
    const referent = await prisma.patientReferent.findFirst({
      where: { patientId },
      include: { pro: { select: { userId: true } } },
    })
    expect(referent).not.toBeNull()
    expect(referent?.patientId).toBe(patientId)
    expect(referent?.pro?.userId).toBe(actorUserId)
  })

  it("rejects duplicate emails with no orphan referent", async () => {
    if (!postgresReachable) return
    // The first POST succeeds (Patient + PatientReferent created in TX).
    // The second POST may be rejected either by the pre-check `findUnique` or
    // by the P2002 unique-constraint mapping AFTER the TX rolls back; both
    // paths must leave the DB in the same state — no duplicate User, no
    // orphan PatientReferent.
    const ok = await POST(makeReq(VALID_BODY))
    expect(ok.status).toBe(201)

    const conflict = await POST(makeReq(VALID_BODY))
    expect(conflict.status).toBe(409)

    const emailHmac = hmacEmail(VALID_BODY.email)
    const userCount = await prisma.user.count({ where: { emailHmac } })
    expect(userCount).toBe(1)

    const referents = await prisma.patientReferent.findMany({
      where: { patient: { user: { emailHmac } } },
    })
    expect(referents).toHaveLength(1)
  })
})
