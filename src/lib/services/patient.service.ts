import { prisma } from "@/lib/db/client"
import { encrypt, decrypt } from "@/lib/crypto/health-data"
import { auditService } from "./audit.service"
import type { Pathology, Prisma } from "@prisma/client"

export interface AuditContext {
  ipAddress?: string
  userAgent?: string
}

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

/** Try to decrypt, return null if decryption fails — never leak ciphertext */
function safeDecrypt(value: string | null): string | null {
  if (!value) return null
  try {
    return decryptField(value)
  } catch {
    return null
  }
}

/** Fields in PatientMedicalData that are encrypted */
const ENCRYPTED_MEDICAL_FIELDS = new Set([
  "historyMedical", "historyChirurgical", "historyFamily",
  "historyAllergy", "historyVaccine", "historyLife",
  "pathology", "diabetDiscovery",
])

/** Decrypt encrypted fields in a medical data record */
function decryptMedicalData(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data }
  for (const field of ENCRYPTED_MEDICAL_FIELDS) {
    if (typeof result[field] === "string") {
      result[field] = safeDecrypt(result[field] as string)
    }
  }
  return result
}

/** Encrypt fields in a medical data update input */
function encryptMedicalInput(input: Record<string, unknown>): Record<string, unknown> {
  const result = { ...input }
  for (const [key, value] of Object.entries(result)) {
    if (ENCRYPTED_MEDICAL_FIELDS.has(key) && typeof value === "string") {
      result[key] = encryptField(value)
    }
  }
  return result
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

  async getById(id: number, auditUserId: number, ctx?: AuditContext) {
    const patient = await prisma.patient.findFirst({
      where: { id, deletedAt: null },
      include: {
        user: { select: { id: true, firstname: true, lastname: true, email: true, sex: true, birthday: true } },
        medicalData: true,
        administrative: true,
        glycemiaObjectives: { where: { isCurrent: true } },
        cgmObjectives: true,
        annexObjectives: true,
        treatments: true,
        referent: { include: { pro: { select: { id: true, name: true } } } },
        patientServices: { include: { service: { select: { id: true, name: true } } } },
        devices: true,
      },
    })

    if (!patient) return null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      resourceId: String(patient.id),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    // Decrypt PII fields
    const decryptedUser = {
      ...patient.user,
      firstname: safeDecrypt(patient.user.firstname),
      lastname: safeDecrypt(patient.user.lastname),
    }

    // Decrypt medical data if present
    const decryptedMedical = patient.medicalData
      ? decryptMedicalData(patient.medicalData as unknown as Record<string, unknown>)
      : null

    return {
      ...patient,
      user: decryptedUser,
      medicalData: decryptedMedical,
    }
  },

  async getByUserId(userId: number, auditUserId: number, ctx?: AuditContext) {
    const patient = await prisma.patient.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    })
    if (!patient) return null
    return this.getById(patient.id, auditUserId, ctx)
  },

  async updateProfile(
    patientId: number,
    input: { pathology?: Pathology },
    auditUserId: number,
  ) {
    return prisma.$transaction(async (tx) => {
      // Guard: verify patient exists and is not soft-deleted
      const existing = await tx.patient.findFirst({
        where: { id: patientId, deletedAt: null },
      })
      if (!existing) throw new Error("Patient not found or deleted")

      const patient = await tx.patient.update({
        where: { id: patientId },
        data: input,
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: String(patientId),
        metadata: { updatedFields: Object.keys(input) },
      })

      return { id: patient.id, pathology: patient.pathology }
    })
  },

  async getMedicalData(patientId: number, auditUserId: number, ctx?: AuditContext) {
    const data = await prisma.patientMedicalData.findUnique({
      where: { patientId },
    })

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      resourceId: `${patientId}:medicalData`,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
    })

    if (!data) return null
    return decryptMedicalData(data as unknown as Record<string, unknown>)
  },

  async updateMedicalData(
    patientId: number,
    input: Record<string, unknown>,
    auditUserId: number,
  ) {
    const encrypted = encryptMedicalInput(input)

    return prisma.$transaction(async (tx) => {
      const data = await tx.patientMedicalData.upsert({
        where: { patientId },
        update: encrypted as Prisma.PatientMedicalDataUpdateInput,
        create: { patientId, ...encrypted } as Prisma.PatientMedicalDataUncheckedCreateInput,
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${patientId}:medicalData`,
        metadata: { updatedFields: Object.keys(input) },
      })

      return decryptMedicalData(data as unknown as Record<string, unknown>)
    })
  },

  async listByDoctor(doctorUserId: number, auditUserId: number) {
    const referents = await prisma.patientReferent.findMany({
      where: {
        pro: { userId: doctorUserId },
        patient: { deletedAt: null },
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

    // Decrypt PII fields before returning — never expose ciphertext
    return referents.map((r) => ({
      ...r.patient,
      user: {
        ...r.patient.user,
        firstname: safeDecrypt(r.patient.user.firstname),
        lastname: safeDecrypt(r.patient.user.lastname),
        email: safeDecrypt(r.patient.user.email),
      },
    }))
  },

  /** Soft delete — anonymise les données (RGPD) */
  async delete(id: number, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.patient.findUnique({ where: { id } })
      if (!existing || existing.deletedAt) {
        throw new Error("Patient not found or already deleted")
      }

      const patient = await tx.patient.update({
        where: { id },
        data: { deletedAt: new Date() },
      })

      await tx.user.update({
        where: { id: patient.userId },
        data: {
          firstname: encryptField("ANONYMISE"),
          lastname: encryptField("ANONYMISE"),
          email: encryptField(`deleted-${patient.userId}@anonymized.local`),
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
