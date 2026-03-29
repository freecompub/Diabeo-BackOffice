import { randomBytes } from "crypto"
import { prisma } from "@/lib/db/client"
import { encrypt, decrypt } from "@/lib/crypto/health-data"
import { auditService } from "./audit.service"
import type { DiabetesType } from "@prisma/client"

interface PersonalData {
  firstName: string
  lastName: string
  birthDate: string
  email?: string
  phone?: string
}

interface CreatePatientInput {
  diabetesType: DiabetesType
  personalData: PersonalData
  doctorId: string
}

function generatePseudonymId(): string {
  const year = new Date().getFullYear()
  const random = randomBytes(4).toString("hex").toUpperCase()
  return `PAT-${year}-${random}`
}

export const patientService = {
  async create(input: CreatePatientInput, userId: string) {
    const encryptedData = encrypt(JSON.stringify(input.personalData))

    return prisma.$transaction(async (tx) => {
      const patient = await tx.patient.create({
        data: {
          pseudonymId: generatePseudonymId(),
          encryptedData,
          diabetesType: input.diabetesType,
          doctorId: input.doctorId,
        },
      })

      await auditService.logWithTx(tx, {
        userId,
        action: "CREATE",
        resource: "PATIENT",
        resourceId: patient.id,
      })

      return { id: patient.id, pseudonymId: patient.pseudonymId, diabetesType: patient.diabetesType }
    })
  },

  async getById(id: string, userId: string) {
    const patient = await prisma.patient.findFirst({
      where: { id, deletedAt: null },
    })

    if (!patient) return null

    await auditService.log({
      userId,
      action: "READ",
      resource: "PATIENT",
      resourceId: patient.id,
    })

    const personalData: PersonalData = JSON.parse(
      decrypt(patient.encryptedData)
    )

    const { encryptedData: _, ...safe } = patient
    return { ...safe, personalData }
  },

  async list(doctorId: string, userId: string) {
    const patients = await prisma.patient.findMany({
      where: { doctorId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    })

    await auditService.log({
      userId,
      action: "READ",
      resource: "PATIENT",
      resourceId: `doctor:${doctorId}`,
      metadata: { action: "list", count: String(patients.length) },
    })

    return patients.map((patient) => {
      const personalData: PersonalData = JSON.parse(
        decrypt(patient.encryptedData)
      )
      const { encryptedData: _, ...safe } = patient
      return { ...safe, personalData }
    })
  },

  /** Soft delete — anonymise les données chiffrées (RGPD) */
  async delete(id: string, userId: string) {
    const anonymized = encrypt(
      JSON.stringify({
        firstName: "SUPPRIMÉ",
        lastName: "SUPPRIMÉ",
        birthDate: "0000-00-00",
      })
    )

    return prisma.$transaction(async (tx) => {
      const patient = await tx.patient.update({
        where: { id },
        data: {
          encryptedData: anonymized,
          deletedAt: new Date(),
        },
      })

      await auditService.logWithTx(tx, {
        userId,
        action: "DELETE",
        resource: "PATIENT",
        resourceId: id,
      })

      return { id: patient.id, pseudonymId: patient.pseudonymId, deletedAt: patient.deletedAt }
    })
  },
}
