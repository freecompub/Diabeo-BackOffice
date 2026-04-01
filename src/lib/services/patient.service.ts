import { prisma } from "@/lib/db/client"
import { encrypt, decrypt } from "@/lib/crypto/health-data"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { auditService, extractRequestContext } from "./audit.service"
import type { Pathology, Prisma, PatientMedicalData } from "@prisma/client"

/** Reusable audit context type — matches extractRequestContext return */
export type AuditContext = ReturnType<typeof extractRequestContext>

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

/** Encrypt a string field to base64 (local shorthand for legacy code) */
function localEncryptField(value: string): string {
  return Buffer.from(encrypt(value)).toString("base64")
}

function localDecryptField(value: string): string {
  return decrypt(new Uint8Array(Buffer.from(value, "base64")))
}

function safeDecrypt(value: string | null): string | null {
  if (!value) return null
  try {
    return localDecryptField(value)
  } catch {
    return null
  }
}

/** Encrypted fields in PatientMedicalData — typed to actual model keys */
type MedicalEncryptedField =
  | "historyMedical" | "historyChirurgical" | "historyFamily"
  | "historyAllergy" | "historyVaccine" | "historyLife"
  | "diabetDiscovery"

const ENCRYPTED_MEDICAL_FIELDS: readonly MedicalEncryptedField[] = [
  "historyMedical", "historyChirurgical", "historyFamily",
  "historyAllergy", "historyVaccine", "historyLife",
  "diabetDiscovery",
]

const ENCRYPTED_MEDICAL_SET = new Set<string>(ENCRYPTED_MEDICAL_FIELDS)

/** Decrypt encrypted fields in PatientMedicalData — type-safe, no Record cast */
function decryptMedicalData(data: PatientMedicalData) {
  return {
    ...data,
    historyMedical: safeDecrypt(data.historyMedical),
    historyChirurgical: safeDecrypt(data.historyChirurgical),
    historyFamily: safeDecrypt(data.historyFamily),
    historyAllergy: safeDecrypt(data.historyAllergy),
    historyVaccine: safeDecrypt(data.historyVaccine),
    historyLife: safeDecrypt(data.historyLife),
    diabetDiscovery: safeDecrypt(data.diabetDiscovery),
  }
}

/** Medical data update input — typed from Zod schema in route */
export interface MedicalDataUpdateInput {
  dt1?: boolean
  size?: number
  yearDiag?: number
  insulin?: boolean
  insulinYear?: number
  insulinPump?: boolean
  pathology?: string
  diabetDiscovery?: string
  tabac?: boolean
  alcool?: boolean
  historyMedical?: string
  historyChirurgical?: string
  historyFamily?: string
  historyAllergy?: string
  historyVaccine?: string
  historyLife?: string
  riskWeight?: boolean
  riskTension?: boolean
  riskSedent?: boolean
  riskCholesterol?: boolean
  riskAge?: boolean
  riskHeredit?: boolean
}

/** Encrypt medical fields in an update input */
function encryptMedicalInput(input: MedicalDataUpdateInput): Prisma.PatientMedicalDataUpdateInput {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (ENCRYPTED_MEDICAL_SET.has(key) && typeof value === "string") {
      result[key] = localEncryptField(value)
    } else {
      result[key] = value
    }
  }
  return result as Prisma.PatientMedicalDataUpdateInput
}

export const patientService = {
  async create(input: CreatePatientInput, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: input.userId },
        data: {
          firstname: localEncryptField(input.personalData.firstName),
          lastname: localEncryptField(input.personalData.lastName),
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

    return {
      ...patient,
      user: {
        ...patient.user,
        firstname: safeDecrypt(patient.user.firstname),
        lastname: safeDecrypt(patient.user.lastname),
        email: safeDecrypt(patient.user.email),
      },
      medicalData: patient.medicalData ? decryptMedicalData(patient.medicalData) : null,
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
    return decryptMedicalData(data)
  },

  async updateMedicalData(
    patientId: number,
    input: MedicalDataUpdateInput,
    auditUserId: number,
  ) {
    const encrypted = encryptMedicalInput(input)

    return prisma.$transaction(async (tx) => {
      const data = await tx.patientMedicalData.upsert({
        where: { patientId },
        update: encrypted,
        create: { patientId, ...encrypted } as Prisma.PatientMedicalDataUncheckedCreateInput,
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "PATIENT",
        resourceId: `${patientId}:medicalData`,
        metadata: { updatedFields: Object.keys(input) },
      })

      return { patientId: data.patientId, updated: true }
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
