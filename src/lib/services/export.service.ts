import { prisma } from "@/lib/db/client"
import { decrypt } from "@/lib/crypto/health-data"

function safeDecrypt(value: string | null): string | null {
  if (!value) return null
  try {
    return decrypt(new Uint8Array(Buffer.from(value, "base64")))
  } catch {
    return null
  }
}

/** Decrypt encrypted fields in PatientMedicalData */
function decryptMedicalData(data: Record<string, unknown> | null) {
  if (!data) return null
  const encryptedMedicalFields = [
    "historyMedical", "historyChirurgical", "historyFamily",
    "historyAllergy", "historyVaccine", "historyLife",
  ]
  const result = { ...data }
  for (const field of encryptedMedicalFields) {
    if (typeof result[field] === "string") {
      result[field] = safeDecrypt(result[field] as string)
    }
  }
  return result
}

/**
 * Generate a complete GDPR export of all user data.
 * Decrypts all encrypted fields for the user's own export.
 */
export async function generateUserExport(userId: number) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return null

  const [unitPreferences, notifPreferences, privacySettings, dayMoments] =
    await Promise.all([
      prisma.userUnitPreferences.findUnique({ where: { userId } }),
      prisma.userNotifPreferences.findUnique({ where: { userId } }),
      prisma.userPrivacySettings.findUnique({ where: { userId } }),
      prisma.userDayMoment.findMany({ where: { userId } }),
    ])

  const patient = await prisma.patient.findUnique({ where: { userId } })

  let patientData = null
  if (patient) {
    const pid = patient.id
    const [
      medicalData,
      glycemiaObjectives,
      cgmObjective,
      annexObjective,
      treatments,
      insulinTherapySettings,
      cgmEntries,
      glycemiaEntries,
      diabetesEvents,
      bolusLogs,
      adjustmentProposals,
      devices,
      appointments,
      documents,
    ] = await Promise.all([
      prisma.patientMedicalData.findUnique({ where: { patientId: pid } }),
      prisma.glycemiaObjective.findMany({ where: { patientId: pid } }),
      prisma.cgmObjective.findUnique({ where: { patientId: pid } }),
      prisma.annexObjective.findUnique({ where: { patientId: pid } }),
      prisma.treatment.findMany({ where: { patientId: pid } }),
      prisma.insulinTherapySettings.findUnique({
        where: { patientId: pid },
        include: {
          glucoseTargets: true,
          iobSettings: true,
          sensitivityFactors: true,
          carbRatios: true,
          basalConfiguration: { include: { pumpSlots: true } },
        },
      }),
      prisma.cgmEntry.findMany({ where: { patientId: pid }, orderBy: { timestamp: "desc" }, take: 10000 }),
      prisma.glycemiaEntry.findMany({ where: { patientId: pid }, orderBy: { date: "desc" }, take: 10000 }),
      prisma.diabetesEvent.findMany({ where: { patientId: pid }, orderBy: { createdAt: "desc" }, take: 5000 }),
      prisma.bolusCalculationLog.findMany({ where: { patientId: pid }, orderBy: { calculatedAt: "desc" }, take: 5000 }),
      prisma.adjustmentProposal.findMany({ where: { patientId: pid }, orderBy: { createdAt: "desc" } }),
      prisma.patientDevice.findMany({ where: { patientId: pid } }),
      prisma.appointment.findMany({ where: { patientId: pid }, orderBy: { date: "desc" } }),
      prisma.medicalDocument.findMany({ where: { patientId: pid }, orderBy: { createdAt: "desc" } }),
    ])

    patientData = {
      pathology: patient.pathology,
      medicalData: decryptMedicalData(medicalData as unknown as Record<string, unknown>),
      objectives: { glycemia: glycemiaObjectives, cgm: cgmObjective, annex: annexObjective },
      treatments,
      insulinTherapy: insulinTherapySettings,
      cgmEntries,
      glycemiaEntries,
      diabetesEvents,
      bolusLogs,
      adjustmentProposals,
      devices,
      appointments,
      documents: documents.map((d) => ({
        id: d.id,
        title: d.title,
        category: d.category,
        createdAt: d.createdAt,
      })),
    }
  }

  return {
    exportDate: new Date().toISOString(),
    userId: user.id,
    profile: {
      email: safeDecrypt(user.email),
      firstname: safeDecrypt(user.firstname),
      lastname: safeDecrypt(user.lastname),
      birthday: user.birthday ? user.birthday.toISOString().split("T")[0] : null,
      sex: user.sex,
      phone: safeDecrypt(user.phone),
      address1: safeDecrypt(user.address1),
      address2: safeDecrypt(user.address2),
      cp: safeDecrypt(user.cp),
      city: safeDecrypt(user.city),
      country: user.country,
      language: user.language,
      timezone: user.timezone,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
    },
    preferences: { units: unitPreferences, notifications: notifPreferences, privacy: privacySettings, dayMoments },
    patient: patientData,
  }
}
