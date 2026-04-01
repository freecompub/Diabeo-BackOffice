import { prisma } from "@/lib/db/client"
import { createHash } from "crypto"
import { auditService } from "./audit.service"

/**
 * GDPR Article 17 — Right to erasure.
 * Cascade delete all user data in correct FK order.
 * An audit log entry is created BEFORE deletion (the only log that survives).
 */
export async function deleteUserAccount(
  userId: number,
  ipAddress: string,
  userAgent: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, patient: { select: { id: true } } },
  })

  if (!user) throw new Error("User not found")

  const emailHash = createHash("sha256")
    .update(`deleted-${userId}-${Date.now()}`)
    .digest("hex")

  return prisma.$transaction(async (tx) => {
    // Audit BEFORE deletion — this log survives
    await auditService.logWithTx(tx, {
      userId,
      action: "DELETE",
      resource: "USER",
      resourceId: String(userId),
      ipAddress,
      userAgent,
      metadata: { type: "gdpr_erasure" },
    })

    // Delete push notification data
    await tx.pushScheduledNotification.deleteMany({ where: { userId } })
    await tx.pushNotificationLog.deleteMany({ where: { userId } })
    await tx.pushDeviceRegistration.deleteMany({ where: { userId } })

    // Delete sessions
    await tx.session.deleteMany({ where: { userId } })
    await tx.account.deleteMany({ where: { userId } })

    // Delete UI state & dashboard
    await tx.uiStateSave.deleteMany({ where: { userId } })
    const dashConfig = await tx.dashboardConfiguration.findUnique({ where: { userId } })
    if (dashConfig) {
      await tx.dashboardWidget.deleteMany({ where: { configId: dashConfig.id } })
      await tx.dashboardConfiguration.delete({ where: { userId } })
    }

    // Delete preferences
    await tx.userDayMoment.deleteMany({ where: { userId } })
    await tx.userUnitPreferences.deleteMany({ where: { userId } })
    await tx.userNotifPreferences.deleteMany({ where: { userId } })
    await tx.userPrivacySettings.deleteMany({ where: { userId } })

    // Delete patient data if exists
    if (user.patient) {
      const patientId = user.patient.id

      // Device sync & devices
      await tx.deviceDataSync.deleteMany({ where: { userId } })
      await tx.patientDevice.deleteMany({ where: { patientId } })

      // Medical documents & appointments
      await tx.medicalDocument.deleteMany({ where: { patientId } })
      await tx.appointment.deleteMany({ where: { patientId } })

      // Adjustment proposals
      await tx.adjustmentProposal.deleteMany({ where: { patientId } })

      // Bolus logs
      await tx.bolusCalculationLog.deleteMany({ where: { patientId } })

      // Health data
      await tx.cgmEntry.deleteMany({ where: { patientId } })
      await tx.glycemiaEntry.deleteMany({ where: { patientId } })
      await tx.diabetesEvent.deleteMany({ where: { patientId } })
      await tx.insulinFlowEntry.deleteMany({ where: { patientId } })
      await tx.pumpEvent.deleteMany({ where: { patientId } })

      // Insulin therapy settings cascade
      const settings = await tx.insulinTherapySettings.findUnique({
        where: { patientId },
        select: { id: true, basalConfiguration: { select: { id: true } } },
      })
      if (settings) {
        if (settings.basalConfiguration) {
          await tx.pumpBasalSlot.deleteMany({ where: { basalConfigId: settings.basalConfiguration.id } })
          await tx.basalConfiguration.delete({ where: { settingsId: settings.id } })
        }
        await tx.glucoseTarget.deleteMany({ where: { settingsId: settings.id } })
        await tx.iobSettings.deleteMany({ where: { settingsId: settings.id } })
        await tx.extendedBolusSettings.deleteMany({ where: { settingsId: settings.id } })
        await tx.insulinSensitivityFactor.deleteMany({ where: { settingsId: settings.id } })
        await tx.carbRatio.deleteMany({ where: { settingsId: settings.id } })
        await tx.insulinTherapySettings.delete({ where: { patientId } })
      }

      // Objectives & treatments
      await tx.glycemiaObjective.deleteMany({ where: { patientId } })
      await tx.cgmObjective.deleteMany({ where: { patientId } })
      await tx.annexObjective.deleteMany({ where: { patientId } })
      await tx.treatment.deleteMany({ where: { patientId } })

      // Patient referents & service links
      await tx.patientReferent.deleteMany({ where: { patientId } })
      await tx.patientService.deleteMany({ where: { patientId } })

      // Medical data & administrative
      await tx.patientMedicalData.deleteMany({ where: { patientId } })
      await tx.patientAdministrative.deleteMany({ where: { patientId } })
      await tx.patientPregnancy.deleteMany({ where: { patientId } })

      // Patient record
      await tx.patient.delete({ where: { id: patientId } })
    }

    // Anonymize user — keep the row for audit log FK integrity
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `deleted_${emailHash}`,
        emailHmac: `deleted_${emailHash}`,
        passwordHash: "DELETED",
        firstname: null,
        firstnames: null,
        usedFirstname: null,
        lastname: null,
        usedLastname: null,
        phone: null,
        address1: null,
        address2: null,
        cp: null,
        city: null,
        birthday: null,
        nirpp: null,
        nirppPolicyholder: null,
        ins: null,
        codeBirthPlace: null,
        pic: null,
        mfaSecret: null,
        intercomHash: null,
        deploymentKey: null,
      },
    })

    return { deleted: true, userId }
  })
}
