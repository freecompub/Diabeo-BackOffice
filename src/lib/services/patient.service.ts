import { prisma } from "@/lib/db/client"
import { encrypt, decrypt } from "@/lib/crypto/health-data"
import { auditService } from "./audit.service"
import type { Pathology } from "@prisma/client"

interface PersonalData {
  firstName: string
  lastName: string
  birthDate: string
  email?: string
  phone?: string
}

interface CreatePatientInput {
  pathology: Pathology
  personalData: PersonalData
  userId: number
}

/** Encrypt a string field to base64 for storage in String columns */
function encryptField(value: string): string {
  return Buffer.from(encrypt(value)).toString("base64")
}

/** Decrypt a base64-encoded encrypted field */
function decryptField(value: string): string {
  return decrypt(new Uint8Array(Buffer.from(value, "base64")))
}

export const patientService = {
  async create(input: CreatePatientInput, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: input.userId },
        data: {
          firstname: encryptField(input.personalData.firstName),
          lastname: encryptField(input.personalData.lastName),
        },
      })

      const patient = await tx.patient.create({
        data: {
          userId: input.userId,
          pathology: input.pathology,
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "CREATE",
        resource: "PATIENT",
        resourceId: String(patient.id),
      })

      return { id: patient.id, pathology: patient.pathology }
    })
  },

  async getById(id: number, auditUserId: number) {
    const patient = await prisma.patient.findFirst({
      where: { id },
      include: {
        user: { select: { id: true, firstname: true, lastname: true, email: true, sex: true, birthday: true } },
        medicalData: true,
        cgmObjectives: true,
        annexObjectives: true,
      },
    })

    if (!patient) return null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      resourceId: String(patient.id),
    })

    // Decrypt PII fields if they are encrypted (base64-encoded)
    const decryptedUser = {
      ...patient.user,
      firstname: patient.user.firstname ? safeDecrypt(patient.user.firstname) : null,
      lastname: patient.user.lastname ? safeDecrypt(patient.user.lastname) : null,
    }

    return { ...patient, user: decryptedUser }
  },

  async listByDoctor(doctorUserId: number, auditUserId: number) {
    // Find patients where the doctor's HealthcareMember is the referent
    const referents = await prisma.patientReferent.findMany({
      where: {
        pro: { userId: doctorUserId },
      },
      include: {
        patient: {
          include: {
            user: { select: { id: true, firstname: true, lastname: true, email: true } },
          },
        },
      },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      resourceId: `doctor:${doctorUserId}`,
      metadata: { action: "list", count: referents.length },
    })

    return referents.map((r) => r.patient)
  },

  /** Soft delete — anonymise les donnees (RGPD) */
  async delete(id: number, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      // Guard: check not already deleted
      const existing = await tx.patient.findUnique({ where: { id } })
      if (!existing || existing.deletedAt) {
        throw new Error("Patient not found or already deleted")
      }

      const patient = await tx.patient.update({
        where: { id },
        data: { deletedAt: new Date() },
      })

      // Anonymize user data
      await tx.user.update({
        where: { id: patient.userId },
        data: {
          firstname: "SUPPRIME",
          lastname: "SUPPRIME",
          email: `deleted-${patient.userId}@anonymized.local`,
          emailHmac: `deleted-${patient.userId}`,
          phone: null,
          address1: null,
          address2: null,
          cp: null,
          city: null,
          nirpp: null,
          ins: null,
        },
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "DELETE",
        resource: "PATIENT",
        resourceId: String(id),
      })

      return { id: patient.id, deletedAt: patient.deletedAt }
    })
  },
}

/** Try to decrypt, return raw value if decryption fails (e.g. seed plaintext data) */
function safeDecrypt(value: string): string {
  try {
    return decryptField(value)
  } catch {
    return value
  }
}
