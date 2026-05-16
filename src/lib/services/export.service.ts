/**
 * @module export.service
 * @description GDPR Article 20 — Data portability export.
 * Generates a complete JSON export of all personal data (user + patient data).
 * All encrypted fields are decrypted for the user's own export.
 * @see CLAUDE.md#gdpr — GDPR compliance requirements
 * @see https://eur-lex.europa.eu/eli/reg/2016/679/oj — GDPR Article 20
 */

import { prisma } from "@/lib/db/client"
import { decrypt } from "@/lib/crypto/health-data"

/**
 * Safe decryption — returns null on error instead of throwing.
 * Used in export to handle corrupted data gracefully.
 * @private
 * @param {string | null} value - Base64-encoded ciphertext or null
 * @returns {string | null} Decrypted plaintext or null if decryption fails
 */
function safeDecrypt(value: string | null): string | null {
  if (!value) return null
  try {
    return decrypt(new Uint8Array(Buffer.from(value, "base64")))
  } catch {
    return null
  }
}

/**
 * Decrypt all encrypted medical fields in an object.
 * @private
 * @param {Object | null} data - Medical data record or null
 * @returns {Object | null} Same structure with decrypted fields
 */
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
 * Generate a complete GDPR Article 20 export of all personal data.
 * Decrypts all encrypted PII and medical data for the requesting user.
 * Includes: profile, preferences, patient data, CGM entries, events, insulin logs, documents, appointments.
 * @async
 * @param {number} userId - User ID requesting export (must be the owner)
 * @returns {Promise<Object | null>} Complete export structure with decrypted fields, or null if user not found
 * @returns {Object.exportDate} ISO timestamp of export generation
 * @returns {Object.userId} User ID
 * @returns {Object.profile} Decrypted user profile (email, name, address, etc.)
 * @returns {Object.preferences} User preferences and day moments
 * @returns {Object.patient} Patient data (if user is a patient): medical history, insulin therapy, health data
 * @throws {Error} If patient data is corrupted
 * @see CLAUDE.md#gdpr — Data portability rights
 * @example
 * const export = await generateUserExport(userId)
 * // Return to user as JSON file
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

  // US-2076 — RGPD Art. 20 portability : inclure les messages
  // envoyés/reçus (sent/received). Corps déchiffré au moment de l'export
  // pour livrer un format intelligible (Art. 20 = "lisible par machine").
  //
  // MED-2 review round 3 — Cap `take: 10000` documenté + flag `truncated`
  // pour conformité Art. 20 (sanction CNIL si export silencieusement
  // incomplet — cf. SAN-2022-013, SAN-2023-010).
  const MAX_EXPORT_MESSAGES = 10000 as const
  const [messagesSent, messagesReceived, totalSentCount, totalReceivedCount] =
    await Promise.all([
      prisma.message.findMany({
        where: { fromUserId: userId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: MAX_EXPORT_MESSAGES,
      }),
      prisma.message.findMany({
        where: { toUserId: userId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: MAX_EXPORT_MESSAGES,
      }),
      prisma.message.count({
        where: { fromUserId: userId, deletedAt: null },
      }),
      prisma.message.count({
        where: { toUserId: userId, deletedAt: null },
      }),
    ])
  type MessageRow = (typeof messagesSent)[number]
  const decryptMessageBody = (b: Uint8Array | null): string | null => {
    if (!b) return null
    try {
      return decrypt(new Uint8Array(b))
    } catch {
      return null
    }
  }
  const serializeMessage = (m: MessageRow) => ({
    id: m.id,
    conversationKey: m.conversationKey,
    fromUserId: m.fromUserId,
    toUserId: m.toUserId,
    patientId: m.patientId,
    body: decryptMessageBody(m.bodyEncrypted),
    createdAt: m.createdAt.toISOString(),
    readAt: m.readAt ? m.readAt.toISOString() : null,
  })

  // US-SEC-002: a soft-deleted patient must not export — RGPD Art. 17 +
  // service-layer defense in depth (route-level guard could regress).
  const patient = await prisma.patient.findFirst({
    where: { userId, deletedAt: null },
  })

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

    // HSA H-2 review round 1 — Invoices RGPD Art. 20 portability.
    const invoices = await prisma.invoice.findMany({
      where: { patientId: pid, status: { not: "draft" } },
      include: { items: { orderBy: { position: "asc" } } },
      orderBy: { issuedAt: "desc" },
      take: 1000,
    })

    // C1 — RGPD Art. 20 portability requires intelligible content. Encrypted
    // PHI columns must be decrypted before serialising for the data subject.
    const appointmentsDecrypted = appointments.map((a) => ({
      ...a,
      motifEncrypted: undefined,
      noteEncrypted: undefined,
      cancelReasonEncrypted: undefined,
      motif: safeDecrypt(a.motifEncrypted),
      note: safeDecrypt(a.noteEncrypted),
      cancelReason: safeDecrypt(a.cancelReasonEncrypted),
    }))

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
      appointments: appointmentsDecrypted,
      documents: documents.map((d) => ({
        id: d.id,
        title: d.title,
        category: d.category,
        createdAt: d.createdAt,
      })),
      // HSA H-2 review round 1 — RGPD Art. 20 portability invoices.
      // Pas de PDF S3 dans l'export (download via API authentifiée séparée
      // pour ne pas alourdir le JSON et faciliter la portabilité).
      invoices: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        countryCode: inv.countryCode,
        totalCents: inv.totalCents,
        taxCents: inv.taxCents,
        currency: inv.currency,
        status: inv.status,
        paymentMethod: inv.paymentMethod,
        issuedAt: inv.issuedAt?.toISOString() ?? null,
        paidAt: inv.paidAt?.toISOString() ?? null,
        items: inv.items.map((it) => ({
          description: it.description,
          quantity: Number(it.quantity),
          unitPriceCents: it.unitPriceCents,
          taxRate: Number(it.taxRate),
          taxCents: it.taxCents,
          lineTotalCents: it.lineTotalCents,
          position: it.position,
        })),
        pdfDownloadEndpoint: inv.pdfHash
          ? `/api/billing/invoices/${inv.id}/pdf`
          : null,
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
    // US-2076 — Messages échangés (RGPD Art. 20 portabilité).
    // MED-2 review round 3 — Flag `truncated` + counts complets pour
    // que le data subject sache si son export est partiel (sanction CNIL
    // si truncation silencieuse).
    messages: {
      sent: messagesSent.map(serializeMessage),
      received: messagesReceived.map(serializeMessage),
      totalSent: totalSentCount,
      totalReceived: totalReceivedCount,
      truncated:
        totalSentCount > MAX_EXPORT_MESSAGES ||
        totalReceivedCount > MAX_EXPORT_MESSAGES,
      exportLimit: MAX_EXPORT_MESSAGES,
    },
  }
}
