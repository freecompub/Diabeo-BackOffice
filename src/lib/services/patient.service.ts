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

import { randomBytes, randomUUID } from "crypto"
import { hash as bcryptHash } from "bcryptjs"
import { prisma } from "@/lib/db/client"
import { encrypt, decrypt } from "@/lib/crypto/health-data"
import { encryptField } from "@/lib/crypto/fields"
import { hmacField, hmacEmail } from "@/lib/crypto/hmac"
import { auditService, extractRequestContext } from "./audit.service"
import type { PatientListItemDto } from "@/lib/dto/patient"
import { logger } from "@/lib/logger"
import { Prisma } from "@prisma/client"
import type { Pathology, Sex, PatientMedicalData } from "@prisma/client"

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
 * Input for creating a brand-new patient AND its backing User account in one
 * go (no pre-existing user). Used by `POST /api/patients` (new-patient wizard).
 * @typedef {Object} CreatePatientWithUserInput
 */
export interface CreatePatientWithUserInput {
  email: string
  firstName: string
  lastName: string
  sex?: Sex
  /** ISO date "yyyy-mm-dd" (stored as a real Date in User.birthday, not encrypted). */
  birthday?: string
  pathology: Pathology
  /** Year of diabetes diagnosis → PatientMedicalData.yearDiag. */
  yearDiag?: number
}

/**
 * Result of {@link patientService.createWithNewUser}. `resetToken` is the
 * one-time invitation token (set-password link) — used to send the email,
 * NEVER returned to the HTTP client.
 */
export interface CreatePatientWithUserResult {
  id: number
  userId: number
  pathology: Pathology
  resetToken: string
}

/** Stable, non-leaky error codes for patient creation (mapped to HTTP by the route). */
export type PatientCreationErrorCode = "emailExists"

/**
 * Typed creation error — lets the API route map a known business failure to a
 * specific HTTP status/message without leaking internals or stack traces.
 */
export class PatientCreationError extends Error {
  constructor(public readonly code: PatientCreationErrorCode) {
    super(code)
    this.name = "PatientCreationError"
  }
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
 * #474 R4 — Throttle du warn de `safeDecrypt`. `safeDecrypt` est appelé ~16× par
 * enregistrement sur les chemins de liste ; sans throttle, une mauvaise clé / un
 * dump restauré émettrait des centaines de warns par requête (flooding Loki/OVH
 * + corrélation volumétrique = fuite indirecte de la taille de cohorte). On émet
 * au plus 1 warn / fenêtre / process, en reportant le nombre d'occurrences
 * supprimées depuis le dernier warn (`suppressedSinceLastLog`).
 *
 * RR1 (review round 2) — Le throttle est volontairement **process-global** (un
 * seul compteur), PAS per-user comme `messaging.service`. Raison : `safeDecrypt`
 * reçoit un `value` opaque sans `userId`/`patientId` en contexte → une clé
 * per-entity est impossible sans changer la signature, et un échec isolé (1/min)
 * émet quand même son warn (non masqué). Seul le scénario de masse est throttlé.
 *
 * RR2 (review round 2) — `suppressedSinceLastLog` est remis à 0 à chaque fenêtre
 * (≠ cumul process-life) + cappé pour éviter tout overflow théorique et borner
 * l'oracle volumétrique du log SOC.
 */
// prisma-specialist F5 — safety cap pour `listByDoctor`. Le portefeuille d'un
// PS dépasse rarement quelques centaines de patients ; au-delà, pagination
// nécessaire (V1.5). Ces bornes évitent l'OOM en attendant.
const LIST_BY_DOCTOR_MAX = 2000
const LIST_BY_DOCTOR_WARN_AT = 1000

const DECRYPT_WARN_WINDOW_MS = 60_000
const DECRYPT_SUPPRESSED_CAP = 10_000_000
/**
 * HSA H3 — Au-delà de ce seuil dans une seule fenêtre, on escalade `warn → error`
 * ET on émet un `ENCRYPTION_FAILURE` audit log (signal SOC aggregable cross-pods
 * via la table immuable `audit_logs`, vs `logger.warn` qui se dilue dans Loki).
 * Le seuil est volontairement bas (10 échecs/min) car en prod la cible est 0 :
 * un dépassement = incident à investiguer (bascule de clé ratée, dump restauré).
 */
const DECRYPT_FAIL_AUDIT_THRESHOLD = 10
let lastDecryptWarnAt = 0
let suppressedDecryptWarns = 0
let decryptFailureAuditedAt = 0

/**
 * Test-only — réinitialise l'état du throttle de `safeDecrypt` (RR4) pour que
 * les specs partent d'un état déterministe (état module partagé entre tests).
 * @internal
 */
export function __resetDecryptWarnThrottleForTests(): void {
  lastDecryptWarnAt = 0
  suppressedDecryptWarns = 0
  decryptFailureAuditedAt = 0
}

/**
 * Safe decryption — returns null on error instead of throwing.
 * Used in read operations to handle corrupted or missing data gracefully.
 * @private
 * @param {string | null} value - Base64-encoded ciphertext or null
 * @returns {string | null} Decrypted plaintext or null if decryption fails
 */
function safeDecrypt(value: string | null, scope = "patient.user"): string | null {
  if (!value) return null
  try {
    return localDecryptField(value)
  } catch {
    // #474 §11 — Surfacer le swallow silencieux : un échec signale soit des
    // données seedées en clair (dev — corrigé par le seed chiffré), soit un PHI
    // réellement corrompu / mauvaise clé (prod — incident à investiguer).
    // Aucune valeur loggée (PHI/ciphertext potentiel) ; throttlé (R4) ; `kind`
    // pour le filtrage SOC (R7).
    const now = Date.now()
    if (now - lastDecryptWarnAt >= DECRYPT_WARN_WINDOW_MS) {
      const burst = suppressedDecryptWarns
      const escalate = burst >= DECRYPT_FAIL_AUDIT_THRESHOLD
      // HSA H3 — au-delà du seuil, on escalade en `error` (PagerDuty/SOC) ET on
      // émet un audit immuable `ENCRYPTION_FAILURE` aggregable cross-pods. En
      // dessous, le `warn` reste pour le bruit isolé (dev / dump test).
      const meta = {
        kind: "phi.decrypt.fail",
        scope,
        ...(burst > 0 ? { suppressedSinceLastLog: burst } : {}),
      }
      if (escalate) {
        logger.error("patient.service", "safeDecrypt mass failure — investigate key rotation", meta)
        // Audit (immuable) — au plus 1 par fenêtre pour ne pas saturer la table.
        if (now - decryptFailureAuditedAt >= DECRYPT_WARN_WINDOW_MS) {
          decryptFailureAuditedAt = now
          // Fire-and-forget : un échec d'écriture audit ne doit JAMAIS bloquer
          // la lecture patient (UX dégradée OK vs 500 complet sur la liste).
          // Review round 2 M2 — `CONFIG_ERROR` sémantiquement correct (pattern
          // déjà utilisé par insulin.service / emergency.service pour les
          // drift de config). `READ` ne capturait pas la nature "incident".
          auditService.log({
            userId: null,
            action: "CONFIG_ERROR",
            resource: "ENCRYPTION_FAILURE",
            resourceId: scope,
            metadata: { kind: "phi.decrypt.fail", suppressedSinceLastLog: burst, scope },
          }).catch((auditErr) => {
            // architect-reviewer M : ne PAS swallow l'erreur d'audit silencieusement
            // (perdrait le signal SOC précisément quand on en a le plus besoin).
            // Au minimum, escalader vers Loki/stderr — un opérateur peut grep ce
            // log même si la table audit_logs est inaccessible (DB down).
            logger.error("patient.service", "ENCRYPTION_FAILURE audit emission failed", { scope }, auditErr)
          })
        }
      } else {
        logger.warn(
          "patient.service",
          "safeDecrypt failed — returning null (plaintext seed or corrupted ciphertext?)",
          meta,
        )
      }
      lastDecryptWarnAt = now
      suppressedDecryptWarns = 0
    } else if (suppressedDecryptWarns < DECRYPT_SUPPRESSED_CAP) {
      suppressedDecryptWarns++
    }
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
    // Review round 2 M1 — scope explicite pour que le triage SOC pointe sur la
    // bonne clé (PatientMedicalData a sa propre surface forensique vs
    // patient.user qui est le default de safeDecrypt).
    historyMedical: safeDecrypt(data.historyMedical, "patient.medicalData"),
    historyChirurgical: safeDecrypt(data.historyChirurgical, "patient.medicalData"),
    historyFamily: safeDecrypt(data.historyFamily, "patient.medicalData"),
    historyAllergy: safeDecrypt(data.historyAllergy, "patient.medicalData"),
    historyVaccine: safeDecrypt(data.historyVaccine, "patient.medicalData"),
    historyLife: safeDecrypt(data.historyLife, "patient.medicalData"),
    diabetDiscovery: safeDecrypt(data.diabetDiscovery, "patient.medicalData"),
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
        // US-2268 — patientId pivot pour forensics getByPatient.
        metadata: { patientId: patient.id },
      })

      return { id: patient.id, pathology: patient.pathology }
    })
  },

  /**
   * Create a brand-new patient together with its backing User account.
   *
   * Unlike {@link patientService.create} (which links to an existing user),
   * this provisions the whole identity:
   *   - User (encrypted email + emailHmac unique lookup, encrypted names,
   *     random throwaway password — the patient sets a real one via the
   *     invitation email), role VIEWER, `needPasswordUpdate`/`needOnboarding`.
   *   - Patient (pathology) and optional PatientMedicalData (yearDiag).
   *   - A one-time invitation token (same mechanism as the password-reset
   *     flow) so the caller can email a set-password link.
   *   - Atomic audit logs CREATE USER + CREATE PATIENT (US-2268 patientId pivot).
   *
   * Everything runs in a single transaction. Email uniqueness is enforced both
   * by a friendly pre-check and the DB unique constraint on `emailHmac`
   * (race-safe — P2002 is mapped to `emailExists`).
   *
   * @async
   * @param {CreatePatientWithUserInput} input - Patient + user identity data
   * @param {number} auditUserId - Healthcare pro performing the creation
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<CreatePatientWithUserResult>} Created patient id, user id, pathology and invitation token
   * @throws {PatientCreationError} `emailExists` if the email is already in use
   */
  async createWithNewUser(
    input: CreatePatientWithUserInput,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<CreatePatientWithUserResult> {
    const emailHmac = hmacEmail(input.email)

    // Friendly pre-check (the DB unique constraint below is the real guard).
    const existing = await prisma.user.findUnique({
      where: { emailHmac },
      select: { id: true },
    })
    if (existing) throw new PatientCreationError("emailExists")

    // Throwaway password — never communicated. The patient defines a real one
    // through the invitation (set-password) email. bcrypt cost 12 = runtime.
    const tempPasswordHash = await bcryptHash(randomBytes(32).toString("base64url"), 12)
    const resetToken = randomUUID()

    try {
      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: localEncryptField(input.email),
            emailHmac,
            passwordHash: tempPasswordHash,
            firstname: localEncryptField(input.firstName),
            firstnameHmac: hmacField(input.firstName),
            lastname: localEncryptField(input.lastName),
            lastnameHmac: hmacField(input.lastName),
            ...(input.sex && { sex: input.sex }),
            ...(input.birthday && { birthday: new Date(input.birthday) }),
            role: "VIEWER",
            status: "active",
            language: "fr",
            needPasswordUpdate: true,
            needOnboarding: true,
          },
          select: { id: true },
        })

        const patient = await tx.patient.create({
          data: { userId: user.id, pathology: input.pathology },
          select: { id: true, pathology: true },
        })

        if (input.yearDiag != null) {
          await tx.patientMedicalData.create({
            data: { patientId: patient.id, yearDiag: input.yearDiag },
          })
        }

        // Link the new patient to the creating professional via PatientReferent
        // (HDS traceability — required so listByDoctor() surfaces the patient in
        // the creator's portfolio, and so all downstream pro↔patient access
        // checks via canAccessPatient() succeed). If the creator has no
        // HealthcareMember (e.g. ADMIN without a clinical role), we skip
        // silently: the patient is still created, but the creator must rely on
        // other access paths (PatientService link or ADMIN bypass).
        const member = await tx.healthcareMember.findUnique({
          where: { userId: auditUserId },
          select: { id: true, serviceId: true },
        })
        let referentSkippedReason: string | null = null
        let referentId: number | null = null
        if (member) {
          // prisma-specialist F2 — defense-in-depth contre race : si le
          // HealthcareMember est supprimé (commit concurrent) entre findUnique
          // et create, le INSERT lève P2003 (FK violation). On traite ça comme
          // "member disparu" → flag referentSkipped au lieu de rollback toute
          // la TX (le patient reste utile, peut être adopté ultérieurement).
          try {
            const referent = await tx.patientReferent.create({
              data: {
                patientId: patient.id,
                proId: member.id,
                serviceId: member.serviceId ?? null,
              },
              select: { id: true },
            })
            referentId = referent.id
          } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
              referentSkippedReason = "member_deleted_during_creation"
            } else {
              throw e
            }
          }
        } else {
          // HSA M4 — flag posé sur l'audit `CREATE PATIENT` ci-dessous (review
          // round 2 H1 — pas de 2e row dédiée). Le patient sans référent ne
          // remontera pas dans `listByDoctor` du créateur ; adoption via
          // dashboard admin V1.5.
          referentSkippedReason = "creator_has_no_healthcare_member"
        }
        if (referentId !== null && member) {
          await auditService.logWithTx(tx, {
            userId: auditUserId,
            action: "CREATE",
            resource: "REFERENT",
            // US-2268 — resourceId = native PatientReferent.id, patientId pivot
            // dans metadata pour la forensique (`getByPatient`).
            resourceId: String(referentId),
            ipAddress: ctx?.ipAddress,
            userAgent: ctx?.userAgent,
            // HSA M3 — enrichi : serviceId (cohérence avec le row inséré) +
            // proUserId (shortcut forensique "tous les patients dont user X
            // est devenu référent", évite le join member → user).
            metadata: {
              patientId: patient.id,
              proMemberId: member.id,
              proUserId: auditUserId,
              serviceId: member.serviceId ?? null,
              via: "patient_creation",
            },
          })
        }

        // Invitation (set-password) token — identical mechanism to the
        // password-reset flow (VerificationToken keyed by emailHmac, 1h TTL).
        await tx.verificationToken.deleteMany({ where: { identifier: emailHmac } })
        await tx.verificationToken.create({
          data: {
            identifier: emailHmac,
            token: resetToken,
            expires: new Date(Date.now() + 3600_000),
          },
        })

        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "CREATE",
          resource: "USER",
          resourceId: String(user.id),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          // US-2268 — patientId pivot so this user-creation event is found by
          // getByPatient forensics. Never log decrypted PII.
          metadata: { patientId: patient.id, role: "VIEWER", via: "patient_creation" },
        })
        await auditService.logWithTx(tx, {
          userId: auditUserId,
          action: "CREATE",
          resource: "PATIENT",
          resourceId: String(patient.id),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          // HSA M4 + round 2 H1 — flag `referentSkipped` posé ici (single audit
          // event) plutôt qu'une 2e row dédiée. Forensique : la query
          // `metadata->>'kind' = 'patient.created_without_referent'` retrouve
          // les patients orphelins pour le dashboard d'adoption (V1.5).
          metadata: {
            patientId: patient.id,
            ...(referentSkippedReason
              ? {
                  referentSkipped: true,
                  kind: "patient.created_without_referent",
                  reason: referentSkippedReason,
                }
              : {}),
          },
        })

        return { id: patient.id, userId: user.id, pathology: patient.pathology }
      })

      return { ...result, resetToken }
    } catch (e) {
      // Race on the emailHmac unique index → friendly business error.
      // Only map P2002 when it actually hits the email_hmac constraint — any
      // other unique conflict (e.g. an astronomically unlikely VerificationToken
      // UUID collision) must surface as the original error, not a misleading
      // "emailExists" (pattern aligned with ins.service.ts meta.target check).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const target = e.meta?.target
        const hitsEmailHmac = Array.isArray(target)
          ? target.some((t) => String(t).includes("email_hmac"))
          : String(target ?? "").includes("email_hmac")
        if (hitsEmailHmac) throw new PatientCreationError("emailExists")
      }
      throw e
    }
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
      // US-2268 — patientId pivot pour forensics getByPatient.
      metadata: { patientId: patient.id },
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
        // US-2268 — patientId pivot pour forensics getByPatient.
        metadata: { patientId, updatedFields: Object.keys(input) },
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
      // US-2268 — singleton par patient → resourceId = patientId, pivot metadata.
      resource: "MEDICAL_DATA",
      resourceId: String(patientId),
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId },
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
        // US-2268 — singleton par patient → resourceId = patientId, pivot metadata.
        resource: "MEDICAL_DATA",
        resourceId: String(patientId),
        metadata: { patientId, updatedFields: Object.keys(input) },
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
  /**
   * US-2019 — Search patients accessible to the caller.
   *
   * Search is implemented with the user-side HMAC pattern (`firstnameHmac` /
   * `lastnameHmac`): the caller types an EXACT firstname or lastname (case-
   * insensitive). No fuzzy match — by design, since the plaintext is AES-256-GCM
   * encrypted. Pathology filter is exact-match on the Patient.pathology enum.
   *
   * Scoping:
   *  - `accessibleIds=null` → ADMIN (no IN-clause).
   *  - `accessibleIds=[]`   → no accessible patients → empty result.
   *  - otherwise → restricted to the given list.
   *
   * Pagination: cursor on `id DESC`. Page size capped server-side.
   */
  async search(
    input: {
      search?: string
      pathology?: Pathology
      accessibleIds: number[] | null
      cursor?: number
      limit?: number
    },
    auditUserId: number,
    ctx?: AuditContext,
  ) {
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 50)

    if (input.accessibleIds !== null && input.accessibleIds.length === 0) {
      // A3 round 2 C-2 (HSA CRITICAL-1) — user authentifié mais sans permission
      // patient = sémantique RBAC failure (US-2265 burst-detectable), pas un
      // READ légitime sans résultats. Pattern accessDenied au lieu de log
      // (révèle compte interne compromis qui sonde l'API en masse).
      await auditService.accessDenied({
        userId: auditUserId,
        resource: "PATIENT",
        resourceId: "search",
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        metadata: {
          reason: "noServiceMembership",
          scoped: true,
        },
      })
      return { items: [], nextCursor: null as number | null }
    }

    const userFilter: Prisma.UserWhereInput | undefined = input.search?.trim()
      // hmacField internally normalizes (lowercase + trim).
      ? (() => {
          const hmac = hmacField(input.search!)
          return { OR: [{ firstnameHmac: hmac }, { lastnameHmac: hmac }] }
        })()
      : undefined

    const where: Prisma.PatientWhereInput = {
      deletedAt: null,
      // H1 — exclude patients who revoked sharing or never accepted GDPR.
      // Matches the same filter applied in `population-analytics.service`
      // (RGPD Art. 7.3 — revocation effective on all aggregations).
      user: {
        privacySettings: { gdprConsent: true, shareWithProviders: true },
        ...(userFilter ?? {}),
      },
      ...(input.accessibleIds !== null && { id: { in: input.accessibleIds } }),
      ...(input.pathology && { pathology: input.pathology }),
    }

    const items = await prisma.patient.findMany({
      where,
      include: {
        user: {
          // Low — data minimization: search list trims to identification
          // fields only. Email / birthday only on the detail endpoint.
          select: { id: true, firstname: true, lastname: true },
        },
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
    })

    const hasMore = items.length > limit
    const page = hasMore ? items.slice(0, limit) : items
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null

    // A3 round 2 C-1 (HSA CRITICAL-2 + CR CRIT-2 + H-1 metadata variance) —
    // adoption retirée : `count`/`hasSearch`/`pathology` à haute variance
    // perdent leur valeur forensique sous coalescing (metadata 1ère wins).
    // De plus, `firstname`/`lastname` déchiffrés ci-dessous = PHI list view
    // qui viole le critère runbook §3.3 "PHI direct → 1:1". Maintenu en
    // `auditService.log` (1 row/event) jusqu'à validation HSA formelle.
    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      resourceId: "search",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      requestId: ctx?.requestId,
      metadata: {
        count: page.length,
        scoped: input.accessibleIds !== null,
        hasSearch: !!input.search,
        pathology: input.pathology ?? null,
      },
    })

    return {
      items: page.map((p) => ({
        id: p.id,
        pathology: p.pathology,
        createdAt: p.createdAt,
        user: {
          id: p.user.id,
          firstname: safeDecrypt(p.user.firstname),
          lastname: safeDecrypt(p.user.lastname),
        },
      })),
      nextCursor,
    }
  },

  /**
   * Lists the patients in a PS's portfolio (via `PatientReferent.pro.userId`)
   * as a minimal `PatientListItemDto[]`. Filters out soft-deleted patients +
   * patients who have explicitly opted out of provider data sharing.
   *
   * Performance bound: V1.5 — capped at LIST_BY_DOCTOR_MAX (2000) rows to
   * prevent OOM on enormous cabinets. Beyond this, the route should paginate.
   * A `logger.warn` is emitted when approaching the cap (≥1000) for capacity
   * monitoring (prisma-specialist F5).
   */
  async listByDoctor(doctorUserId: number, auditUserId: number): Promise<PatientListItemDto[]> {
    const referents = await prisma.patientReferent.findMany({
      take: LIST_BY_DOCTOR_MAX,
      where: {
        pro: { userId: doctorUserId },
        patient: {
          deletedAt: null,
          // HSA H1 + review round 2 C1 — RGPD Art. 7.3 (révocation) tout en
          // respectant le défaut implicite : un patient nouvellement créé n'a
          // PAS encore de row UserPrivacySettings (pas créée par le wizard) →
          // il doit rester visible (sinon le PS qui le crée ne le voit jamais
          // dans son portefeuille). Pattern aligné PR #418 round 3 :
          //   OR (no settings row yet) (opt-out explicit not yet expressed)
          //   OR (gdprConsent && shareWithProviders)  (opt-in confirmé)
          // L'opt-out Art. 21 (révocation explicite via /api/account/privacy)
          // est honoré dès qu'une row existe avec un flag false.
          user: {
            OR: [
              { privacySettings: null },
              { privacySettings: { gdprConsent: true, shareWithProviders: true } },
            ],
          },
        },
      },
      select: {
        patient: {
          select: {
            id: true,
            pathology: true,
            // HSA L1 — `birthday` contractualisé côté DTO pour le calcul d'âge
            // côté UI (cf. PatientListItemDto). À conserver dans la DPIA.
            user: { select: { id: true, firstname: true, lastname: true, birthday: true } },
          },
        },
      },
    })

    if (referents.length >= LIST_BY_DOCTOR_WARN_AT) {
      logger.warn("patient.service", "listByDoctor approaching cap — paginate soon", {
        doctorUserId,
        count: referents.length,
        cap: LIST_BY_DOCTOR_MAX,
      })
    }

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      // US-2268 — listing du portefeuille du médecin. Pas de pivot
      // patientId (vue agrégée multi-patients). On capture le doctorUserId
      // dans metadata pour audit "qui a listé son portefeuille".
      resource: "PATIENT",
      resourceId: "list",
      metadata: { doctorUserId, count: referents.length, capped: referents.length === LIST_BY_DOCTOR_MAX },
    })

    return referents.map((r) => ({
      id: r.patient.id,
      pathology: r.patient.pathology,
      user: {
        id: r.patient.user.id,
        firstname: safeDecrypt(r.patient.user.firstname),
        lastname: safeDecrypt(r.patient.user.lastname),
        // HSA L4 — date-only (YYYY-MM-DD) au lieu d'ISO complet : évite la
        // dérive timezone côté navigateur (un patient né le 15/05 à 00:00 UTC
        // apparaîtrait né le 14/05 dans un navigateur Hawaii).
        birthday: r.patient.user.birthday?.toISOString().slice(0, 10) ?? null,
      },
    }))
  },

  /**
   * Get a minimal summary of a single patient — used by the VIEWER branch of
   * `GET /api/patients` so the patient sees only their own row with the same
   * shape returned by `listByDoctor` for pros. Avoids the over-fetch of
   * `getById` (which decrypts medical data, devices, treatments etc.) — RGPD
   * Art. 5 data minimisation.
   *
   * **Volontairement PAS de filtre `privacySettings`** : un VIEWER qui révoque
   * son `gdprConsent` doit pouvoir continuer à consulter son propre dossier
   * (RGPD Art. 15 droit d'accès au sujet prime sur Art. 7.3 révocation, qui
   * ne s'applique qu'au partage avec des tiers). Décision DPIA §3.3 — ne pas
   * imiter le filtre `listByDoctor` ici par symétrie.
   *
   * @async
   * @param {number} patientId - Patient ID
   * @param {number} auditUserId - User ID performing the read (audit trail)
   * @param {AuditContext} [ctx] - Request context (IP, User-Agent)
   * @returns {Promise<PatientListItemDto | null>} Minimal patient summary, or null if missing/soft-deleted
   */
  async getOwnSummary(
    patientId: number,
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<PatientListItemDto | null> {
    const patient = await prisma.patient.findFirst({
      where: { id: patientId, deletedAt: null },
      select: {
        id: true,
        pathology: true,
        user: { select: { id: true, firstname: true, lastname: true, birthday: true } },
      },
    })
    if (!patient) return null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "PATIENT",
      // VIEWER summary lookup — distinct from `getById`'s full READ. resourceId
      // is "own-summary" (not the patient id) so this aggregate event does not
      // pollute per-patient forensics; the patientId pivot is still in metadata
      // (US-2268).
      resourceId: "own-summary",
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: { patientId: patient.id },
    })

    return {
      id: patient.id,
      pathology: patient.pathology,
      user: {
        id: patient.user.id,
        firstname: safeDecrypt(patient.user.firstname),
        lastname: safeDecrypt(patient.user.lastname),
        // HSA L4 — date-only pour éviter la dérive timezone front (cf. listByDoctor).
        birthday: patient.user.birthday?.toISOString().slice(0, 10) ?? null,
      },
    }
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
        // US-2268 — patientId pivot (soft delete = encore traçable).
        metadata: { patientId: id },
      })

      return { id: patient.id, deletedAt: patient.deletedAt }
    })
  },
}
