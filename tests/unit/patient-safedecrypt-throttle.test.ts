/**
 * Test suite: safeDecrypt warn throttle (#474 R4/RR4)
 *
 * Behavior tested:
 * - `safeDecrypt` (exercised via `patientService.getById` on a record whose PII
 *   columns are NOT valid ciphertext) emits at most ONE `logger.warn` per
 *   throttle window (60s) per process, regardless of how many fields/records
 *   fail to decrypt — preventing log flooding + volumetric correlation.
 * - The throttled warn carries `kind: "phi.decrypt.fail"` (SOC filtering, R7)
 *   and reports `suppressedSinceLastLog` on the next window's emission (RR2).
 * - No PHI/PII/ciphertext value is ever passed to the logger.
 *
 * Risk mitigated:
 * - A mis-rotated key or a restored dump would otherwise emit hundreds of warns
 *   per list request and let a log observer infer cohort size.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { logger } from "@/lib/logger"
import {
  patientService,
  __resetDecryptWarnThrottleForTests,
} from "@/lib/services/patient.service"

/** Patient row whose PII columns are plaintext (invalid ciphertext → decrypt fails). */
function mockPlaintextPatient() {
  prismaMock.patient.findFirst.mockResolvedValue({
    id: 1,
    userId: 10,
    pathology: "DT1",
    deletedAt: null,
    user: {
      id: 10,
      firstname: "PlainTextName",
      lastname: "PlainTextLast",
      email: "plain@test.com",
      sex: "M",
      birthday: null,
    },
    medicalData: null,
    cgmObjectives: null,
    annexObjectives: null,
  } as never)
  prismaMock.auditLog.create.mockResolvedValue({} as never)
}

describe("safeDecrypt warn throttle (#474 R4)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    __resetDecryptWarnThrottleForTests()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-04T10:00:00Z"))
    warnSpy = vi.spyOn(logger, "warn")
    mockPlaintextPatient()
  })

  afterEach(() => {
    warnSpy.mockRestore()
    vi.useRealTimers()
  })

  it("emits a single warn for multiple decrypt failures within one window", async () => {
    // getById decrypts firstname + lastname + email → 3 safeDecrypt failures.
    await patientService.getById(1, 1)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const [scope, , ctx] = warnSpy.mock.calls[0]
    expect(scope).toBe("patient.service")
    expect(ctx).toMatchObject({ kind: "phi.decrypt.fail" })
    // First emission of the window → nothing suppressed yet.
    expect(ctx).not.toHaveProperty("suppressedSinceLastLog")
  })

  it("never passes a decrypted value or ciphertext to the logger", async () => {
    await patientService.getById(1, 1)
    const serialized = JSON.stringify(warnSpy.mock.calls)
    expect(serialized).not.toContain("PlainTextName")
    expect(serialized).not.toContain("PlainTextLast")
    expect(serialized).not.toContain("plain@test.com")
  })

  it("reports suppressedSinceLastLog on the next window's emission", async () => {
    // Window 1: warn #1 emitted, the 2 further failures of the same getById are suppressed.
    await patientService.getById(1, 1)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // Advance past the throttle window.
    vi.setSystemTime(new Date("2026-06-04T10:01:01Z"))

    // Window 2: first failure emits again, now carrying the suppressed count.
    await patientService.getById(1, 1)
    expect(warnSpy).toHaveBeenCalledTimes(2)
    const ctx2 = warnSpy.mock.calls[1][2]
    expect(ctx2).toMatchObject({ kind: "phi.decrypt.fail", suppressedSinceLastLog: 2 })
  })
})
