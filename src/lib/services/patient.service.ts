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

export const patientService = {
  async create(input: CreatePatientInput, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
      // Encrypt personal data into user record fields
      const user = await tx.user.update({
        where: { id: input.userId },
        data: {
          firstname: encrypt(input.personalData.firstName).toString(),
          lastname: encrypt(input.personalData.lastName).toString(),
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
      where: { id, deletedAt: null },
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

    return patient
  },

  async listByDoctor(doctorUserId: number, auditUserId: number) {
    // Find patients where the doctor is the referent
    const referents = await prisma.patientReferent.findMany({
      where: { pro: { service: { members: { some: { id: doctorUserId } } } } },
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

    return referents
      .map((r) => r.patient)
      .filter((p) => p.deletedAt === null)
  },

  /** Soft delete — anonymise les donnees (RGPD) */
  async delete(id: number, auditUserId: number) {
    return prisma.$transaction(async (tx) => {
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
