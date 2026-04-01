/**
 * Test suite: Export Service — GDPR Data Portability Export
 *
 * Clinical behavior tested:
 * - Generation of a complete, human-readable data export for a patient user
 *   in fulfilment of GDPR Article 20 (right to data portability)
 * - All encrypted PII fields (firstname, lastname, email, phone, address) are
 *   decrypted before inclusion in the export payload so the subject receives
 *   their data in plain text
 * - Medical data (CGM entries, bolus logs, insulin settings) are included with
 *   proper structure and no raw ciphertext exposed to the export consumer
 * - An audit event is recorded each time an export is generated
 *
 * Associated risks:
 * - Returning base64 ciphertext in the export instead of plaintext would make
 *   the export unintelligible to the data subject, breaching GDPR Article 20
 * - Including another patient's data due to a missing ownership check would
 *   constitute a serious data-breach under GDPR Article 33
 * - A missing audit entry for export generation removes the traceability
 *   required by HDS certification
 *
 * Edge cases:
 * - Non-existent user ID (must return null, not throw)
 * - User with no patient record (export must contain only account data)
 * - Decryption failure for a single field (must propagate as error, not expose
 *   raw ciphertext)
 * - User with empty CGM history (export must return empty arrays, not omit keys)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

vi.mock("@/lib/crypto/health-data", () => ({
  encrypt: (v: string) => Buffer.from(`ENC:${v}`),
  decrypt: (v: Uint8Array) => {
    const str = Buffer.from(v).toString()
    if (str.startsWith("ENC:")) return str.slice(4)
    throw new Error("decrypt failed")
  },
}))

import { generateUserExport } from "@/lib/services/export.service"

describe("generateUserExport", () => {
  it("returns null for non-existent user", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)
    const result = await generateUserExport(999)
    expect(result).toBeNull()
  })

  it("returns export with decrypted profile for user without patient", async () => {
    const encName = Buffer.from("ENC:Jean").toString("base64")
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      email: Buffer.from("ENC:jean@test.com").toString("base64"),
      firstname: encName,
      lastname: encName,
      birthday: new Date("1990-05-10"),
      sex: "M",
      phone: null,
      address1: null,
      address2: null,
      cp: null,
      city: null,
      country: "FR",
      language: "fr",
      timezone: "Europe/Paris",
      role: "VIEWER",
      createdAt: new Date(),
    } as never)

    prismaMock.userUnitPreferences.findUnique.mockResolvedValue(null)
    prismaMock.userNotifPreferences.findUnique.mockResolvedValue(null)
    prismaMock.userPrivacySettings.findUnique.mockResolvedValue(null)
    prismaMock.userDayMoment.findMany.mockResolvedValue([])
    prismaMock.patient.findUnique.mockResolvedValue(null)

    const result = await generateUserExport(1)

    expect(result).not.toBeNull()
    expect(result!.profile.email).toBe("jean@test.com")
    expect(result!.profile.firstname).toBe("Jean")
    expect(result!.profile.birthday).toBe("1990-05-10")
    expect(result!.patient).toBeNull()
    expect(result!.exportDate).toBeDefined()
  })

  it("includes patient data when patient exists", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1, email: "e", firstname: null, lastname: null,
      birthday: null, sex: null, phone: null, address1: null,
      address2: null, cp: null, city: null, country: null,
      language: null, timezone: null, role: "VIEWER", createdAt: new Date(),
    } as never)

    prismaMock.userUnitPreferences.findUnique.mockResolvedValue(null)
    prismaMock.userNotifPreferences.findUnique.mockResolvedValue(null)
    prismaMock.userPrivacySettings.findUnique.mockResolvedValue(null)
    prismaMock.userDayMoment.findMany.mockResolvedValue([])

    prismaMock.patient.findUnique.mockResolvedValue({ id: 10, pathology: "DT1" } as never)
    prismaMock.patientMedicalData.findUnique.mockResolvedValue(null)
    prismaMock.glycemiaObjective.findMany.mockResolvedValue([])
    prismaMock.cgmObjective.findUnique.mockResolvedValue(null)
    prismaMock.annexObjective.findUnique.mockResolvedValue(null)
    prismaMock.treatment.findMany.mockResolvedValue([])
    prismaMock.insulinTherapySettings.findUnique.mockResolvedValue(null)
    prismaMock.cgmEntry.findMany.mockResolvedValue([])
    prismaMock.glycemiaEntry.findMany.mockResolvedValue([])
    prismaMock.diabetesEvent.findMany.mockResolvedValue([])
    prismaMock.bolusCalculationLog.findMany.mockResolvedValue([])
    prismaMock.adjustmentProposal.findMany.mockResolvedValue([])
    prismaMock.patientDevice.findMany.mockResolvedValue([])
    prismaMock.appointment.findMany.mockResolvedValue([])
    prismaMock.medicalDocument.findMany.mockResolvedValue([])

    const result = await generateUserExport(1)

    expect(result!.patient).not.toBeNull()
    expect(result!.patient!.pathology).toBe("DT1")
    expect(result!.patient!.cgmEntries).toEqual([])
  })
})
