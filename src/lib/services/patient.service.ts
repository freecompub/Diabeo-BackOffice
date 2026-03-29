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
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `PAT-${year}-${random}`
}

export const patientService = {
  async create(input: CreatePatientInput, userId: string) {
    const encryptedData = encrypt(JSON.stringify(input.personalData))

    const patient = await prisma.patient.create({
      data: {
        pseudonymId: generatePseudonymId(),
        encryptedData,
        diabetesType: input.diabetesType,
        doctorId: input.doctorId,
      },
    })

    await auditService.log({
      userId,
      action: "CREATE",
      resource: "PATIENT",
      resourceId: patient.id,
    })

    return patient
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

    return { ...patient, personalData }
  },

  async list(doctorId: string, userId: string) {
    const patients = await prisma.patient.findMany({
      where: { doctorId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    })

    return patients.map((patient) => {
      const personalData: PersonalData = JSON.parse(
        decrypt(patient.encryptedData)
      )
      return { ...patient, personalData }
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

    const patient = await prisma.patient.update({
      where: { id },
      data: {
        encryptedData: anonymized,
        deletedAt: new Date(),
      },
    })

    await auditService.log({
      userId,
      action: "DELETE",
      resource: "PATIENT",
      resourceId: id,
    })

    return patient
  },
}
