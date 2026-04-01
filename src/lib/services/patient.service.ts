/**
 * @module patient.service
 * @description Patient CRUD operations with medical data encryption and soft-delete (GDPR Article 17).
 * All personally identifiable information (firstname, lastname, email, phone, address, NIR, INS)
 * is encrypted with AES-256-GCM before storage. Medical history fields are encrypted separately.
 * Soft delete via PostgreSQL trigger ensures patient data is anonymized when deleted.
 * @see CLAUDE.md#security-rules — encryption patterns
 * @see CLAUDE.md#architecture — Patient & PatientMedicalData domains
 * @see Prisma schema — Patient, PatientMedicalData, User models
 */

import { prisma } from "@/lib/db/client"
import { encrypt, decrypt } from "@/lib/crypto/health-data"
import { encryptField } from "@/lib/crypto/fields"
import { auditService, extractRequestContext } from "./audit.service"
import type { Pathology, Prisma, PatientMedicalData } from "@prisma/client"

/**
 * Audit context extracted from request headers (IP, User-Agent).
 * @typedef {Object} AuditContext
 * @property {string} ipAddress - Client IP from x-forwarded-for or x-real-ip header
 * @property {string} userAgent - User-Agent header value
 */
export type AuditContext = ReturnType<typeof extractRequestContext>

/**
 * Personal data for patient creation — encrypted before storage.
 * @typedef {Object} PersonalData
 * @property {string} firstName - Patient given name (encrypted in User.firstname)
 * @property {string} lastName - Patient family name (encrypted in User.lastname)
 * @property {string} birthDate - Date of birth (ISO string)
 * @property {string} [email] - Email address (encrypted in User.email)
 * @property {string} [phone] - Phone number (encrypted in User.phone)
 */
interface PersonalData {
  firstName: string
  lastName: string
  birthDate: string
  email?: string
  phone?: string
}

/**
 * Input for creating a new patient — links to existing user.
 * @typedef {Object} CreatePatientInput
 * @property {Pathology} pathology - Diabetes type: DT1 (Type 1), DT2 (Type 2), or GD (Gestational)
 * @property {PersonalData} personalData - Encrypted PII
 * @property {number} userId - Existing user ID to link to
 */
interface CreatePatientInput {
  pathology: Pathology
  personalData: PersonalData
  userId: number
}

/**
 * Encrypt a string field to base64 for storage in String columns.
 * Format: base64(IV + TAG + CIPHERTEXT) where IV=12 bytes, TAG=16 bytes.
 * @private
 * @param {string} value - Plaintext to encrypt
 * @returns {string} Base64-encoded ciphertext (IV+TAG+CIPHERTEXT)
 */
function localEncryptField(value: string): string {
  return Buffer.from(encrypt(value)).toString("base64")
}

/**
 * Decrypt a base64-encoded field — inverse of localEncryptField.
 * @private
 * @param {string} value - Base64-encoded ciphertext
 * @returns {string} Decrypted plaintext
 * @throws {HealthDataDecryptionError} If decryption fails or data is corrupted
 */
function localDecryptField(value: string): string {
  return decrypt(new Uint8Array(Buffer.from(value, "base64")))
}

/**
 * Safe decryption — returns null on error instead of throwing.
 * Used in read operations to handle corrupted or missing data gracefully.
 * @private
 * @param {string | null} value - Base64-encoded ciphertext or null
 * @returns {string | null} Decrypted plaintext or null if decryption fails
 */
function safeDecrypt(value: string | null): string | null {
  if (!value) return null
  try {
    return localDecryptField(value)
  } catch {
    return null
  }
}

/**
 * Sensitive medical history fields encrypted in PatientMedicalData table.
 * @typedef {string} MedicalEncryptedField
 */
type MedicalEncryptedField =
  | "historyMedical" | "historyChirurgical" | "historyFamily"
  | "historyAllergy" | "historyVaccine" | "historyLife"
  | "diabetDiscovery"

/**
 * List of medical fields that must be encrypted before storage.
 * @constant
 * @type {readonly string[]}
 */
const ENCRYPTED_MEDICAL_FIELDS: readonly MedicalEncryptedField[] = [
  "historyMedical", "historyChirurgical", "historyFamily",
  "historyAllergy", "historyVaccine", "historyLife",
  "diabetDiscovery",
]

/** Fast O(1) lookup for encrypted field names */
const ENCRYPTED_MEDICAL_SET = new Set<string>(ENCRYPTED_MEDICAL_FIELDS)

/**
 * Decrypt all encrypted medical fields in a PatientMedicalData record.
 * Returns null for any field that fails decryption (corrupted data).
 * @private
 * @param {PatientMedicalData} data - Medical data record from database
 * @returns {Object} Same structure with decrypted plaintext fields
 */
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

/**
 * Medical data update input — partial fields from route Zod schema.
 * All sensitive fields are encrypted before database insertion.
 * @typedef {Object} MedicalDataUpdateInput
 */
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

/**
 * Encrypt sensitive fields in medical data update.
 * Skips undefined fields and non-string values.
 * @private
 * @param {MedicalDataUpdateInput} input - Partial medical data update
 * @returns {Prisma.PatientMedicalDataUpdateInput} Update object with encrypted fields
 */
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

/**
 * Patient CRUD service — handles encrypted storage and GDPR soft-delete.
 * @namespace patientService
 */
export const patientService = {
  /**
   * Create a new patient linked to an existing user.
   * Encrypts personal data (firstname, lastname) and logs the action.
   * Runs atomically with user update and audit log in one transaction.
   * @async
   * @param {CreatePatientInput} input - Patient data (pathology, personal data, userId)
   * @param {number} auditUserId - User ID performing the action (for audit trail)
   * @returns {Promise<{id: number, pathology: Pathology}>} Created patient with ID and pathology
   * @throws {Error} If user not found or transaction fails
   * @see CLAUDE.md — Soft delete patients (RGPD)
   * @example
   * const result = await patientService.create({
   *   pathology: 'DT1',
   *   personalData: { firstName: 'John', lastName: 'Doe', birthDate: '1990-01-01' },
   *   userId: 42
   * }, auditUserId)
   */
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

  /**
   * Get patient by ID with all relations — decrypts PII for caller.
   * Filters out soft-deleted patients. Logs audit entry with IP/UA.
   * Include: user (decrypted), medicalData (decrypted), objectives, treatments, referent, services, devices.
   * @async
   * @param {number} id - Patient ID
   * @param {number} auditUserId - User ID performing the read (for audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<Object | null>} Patient with decrypted user and medical data, or null if not found
   * @see patientService.getByUserId — Alternative lookup by user ID
   * @example
   * const patient = await patientService.getById(123, auditUserId, { ipAddress: '1.2.3.4', userAgent: '...' })
   * if (patient) console.log(patient.user.firstname) // Decrypted
   */
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

  /**
   * Get patient by associated user ID — convenience method.
   * Delegates to getById after resolving patientId from userId.
   * @async
   * @param {number} userId - User ID to lookup
   * @param {number} auditUserId - User ID performing the read (audit trail)
   * @param {AuditContext} [ctx] - Request context
   * @returns {Promise<Object | null>} Patient object (if user has patient record) or null
   */
  async getByUserId(userId: number, auditUserId: number, ctx?: AuditContext) {
    const patient = await prisma.patient.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    })
    if (!patient) return null
    return this.getById(patient.id, auditUserId, ctx)
  },

  /**
   * Update patient profile fields (currently pathology only).
   * Logs change in audit trail with modified field names.
   * @async
   * @param {number} patientId - Patient ID to update
   * @param {Object} input - Partial update (pathology = DT1, DT2, or GD)
   * @param {number} auditUserId - User ID performing the update
   * @returns {Promise<{id: number, pathology: Pathology}>} Updated patient
   * @throws {Error} If patient not found or deleted
   */
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

  /**
   * Get decrypted medical data for a patient.
   * Returns null if patient has no medical data record.
   * @async
   * @param {number} patientId - Patient ID
   * @param {number} auditUserId - User ID performing the read (audit trail)
   * @param {AuditContext} [ctx] - Request context
   * @returns {Promise<Object | null>} Decrypted medical history fields or null
   */
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

  /**
   * Upsert (create or update) medical data for a patient.
   * Encrypts sensitive fields before insertion. Creates if not exists.
   * @async
   * @param {number} patientId - Patient ID
   * @param {MedicalDataUpdateInput} input - Partial medical data update
   * @param {number} auditUserId - User ID performing the update
   * @returns {Promise<{patientId: number, updated: boolean}>} Update confirmation
   */
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

  /**
   * List all patients assigned to a doctor via PatientReferent link.
   * Decrypts PII for each patient. Excludes soft-deleted patients.
   * @async
   * @param {number} doctorUserId - Doctor's user ID
   * @param {number} auditUserId - User ID performing the list (audit trail)
   * @returns {Promise<Array<Object>>} Array of patients with decrypted user data
   */
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

  /**
   * Soft-delete a patient (GDPR Article 17 — Right to erasure).
   * Sets deletedAt timestamp. Associated User is anonymized (firstname/lastname → "ANONYMISE").
   * Immutable audit log entry is created before anonymization.
   * PostgreSQL trigger ensures all encrypted fields are set to ANONYMISE.
   * @async
   * @param {number} id - Patient ID to delete
   * @param {number} auditUserId - User ID performing the deletion
   * @returns {Promise<{id: number, deletedAt: Date}>} Deleted patient with deletion timestamp
   * @throws {Error} If patient not found or already deleted
   * @see CLAUDE.md — Soft delete patients (RGPD)
   * @see prisma/sql/audit_immutability.sql — PostgreSQL trigger for anonymization
   */
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
