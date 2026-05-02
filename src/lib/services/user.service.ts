/**
 * @module user.service
 * @description User profile management — handles encrypted PII (email, name, phone, address).
 * All personally identifiable information is encrypted with AES-256-GCM before storage.
 * Decryption happens at read time only, never in logs.
 * @see CLAUDE.md#security-rules — Field encryption patterns
 * @see src/types/user — ENCRYPTED_USER_FIELDS list
 */

import { prisma } from "@/lib/db/client"
import { encrypt, decrypt } from "@/lib/crypto/health-data"
import { hmacField } from "@/lib/crypto/hmac"
import { auditService } from "./audit.service"
import type { Prisma } from "@prisma/client"
import type { AccountUser, UpdateAccountInput } from "@/types/user"
import { ENCRYPTED_USER_FIELDS, type EncryptedUserField } from "@/types/user"

/**
 * Encrypt a string field to base64 for storage in String columns.
 * Format: base64(IV + TAG + CIPHERTEXT) where IV=12 bytes, TAG=16 bytes.
 * @private
 * @param {string} value - Plaintext to encrypt
 * @returns {string} Base64-encoded ciphertext (IV+TAG+CIPHERTEXT)
 */
function encryptField(value: string): string {
  return Buffer.from(encrypt(value)).toString("base64")
}

/**
 * Safe decryption — returns null on error instead of throwing.
 * Used in read operations to handle corrupted or missing data gracefully.
 * Never leaks ciphertext in error cases.
 * @private
 * @param {string | null} value - Base64-encoded ciphertext or null
 * @returns {string | null} Decrypted plaintext or null if decryption fails
 */
function safeDecryptField(value: string | null): string | null {
  if (!value) return null
  try {
    return decrypt(new Uint8Array(Buffer.from(value, "base64")))
  } catch {
    return null
  }
}

/** Fast O(1) lookup for encrypted field names */
const ENCRYPTED_SET = new Set<string>(ENCRYPTED_USER_FIELDS)

/**
 * Type guard — check if a field name is in the encrypted set.
 * @private
 * @param {string} field - Field name to check
 * @returns {field is EncryptedUserField} True if field should be encrypted
 */
function isEncryptedField(field: string): field is EncryptedUserField {
  return ENCRYPTED_SET.has(field)
}

/**
 * User profile service — encryption/decryption of PII fields.
 * @namespace userService
 */
export const userService = {
  /**
   * Get user profile with all encrypted fields decrypted.
   * Logs READ audit entry.
   * @async
   * @param {number} userId - User ID to retrieve
   * @param {number} auditUserId - User ID performing the read (audit trail)
   * @returns {Promise<AccountUser | null>} User profile (decrypted) or null if not found
   * @example
   * const profile = await userService.getProfile(userId, auditUserId)
   * if (profile) console.log(profile.firstname) // Decrypted plaintext
   */
  async getProfile(userId: number, auditUserId: number): Promise<AccountUser | null> {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return null

    await auditService.log({
      userId: auditUserId,
      action: "READ",
      resource: "USER",
      resourceId: String(userId),
    })

    return {
      id: user.id,
      email: safeDecryptField(user.email) ?? "",
      title: user.title,
      firstname: safeDecryptField(user.firstname),
      lastname: safeDecryptField(user.lastname),
      // birthday is DateTime in schema — format as ISO date string
      birthday: user.birthday ? user.birthday.toISOString().split("T")[0] : null,
      sex: user.sex,
      timezone: user.timezone,
      phone: safeDecryptField(user.phone),
      address1: safeDecryptField(user.address1),
      address2: safeDecryptField(user.address2),
      cp: safeDecryptField(user.cp),
      city: safeDecryptField(user.city),
      country: user.country,
      pic: user.pic,
      language: user.language,
      role: user.role,
      hasSignedTerms: user.hasSignedTerms,
      profileComplete: user.profileComplete,
      needOnboarding: user.needOnboarding,
      mfaEnabled: user.mfaEnabled,
      createdAt: user.createdAt.toISOString(),
    }
  },

  /**
   * Update user profile with selective field encryption.
   * Encrypted fields are encrypted before storage; others stored as-is.
   * Logs UPDATE audit entry with modified field names.
   * @async
   * @param {number} userId - User ID to update
   * @param {UpdateAccountInput} input - Partial profile update (from Zod schema)
   * @param {number} auditUserId - User ID performing the update (audit trail)
   * @returns {Promise<{id: number, updatedAt: string}>} Update confirmation with timestamp
   * @example
   * await userService.updateProfile(userId, {
   *   firstname: 'John',
   *   email: 'john@example.com',
   *   phone: '+33612345678',
   *   timezone: 'Europe/Paris'
   * }, auditUserId)
   */
  async updateProfile(
    userId: number,
    input: UpdateAccountInput,
    auditUserId: number,
  ): Promise<{ id: number; updatedAt: string }> {
    // Build typed update data — encrypt fields that need encryption
    const data: Prisma.UserUpdateInput = {}
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue
      if (key === "birthday") {
        // birthday is DateTime in schema — parse the ISO string
        data.birthday = new Date(value as string)
      } else if (isEncryptedField(key)) {
        ;(data as Record<string, unknown>)[key] = encryptField(String(value))
      } else {
        ;(data as Record<string, unknown>)[key] = value
      }
    }

    if ("firstname" in input && input.firstname) {
      (data as Record<string, unknown>).firstnameHmac = hmacField(String(input.firstname))
    }
    if ("lastname" in input && input.lastname) {
      (data as Record<string, unknown>).lastnameHmac = hmacField(String(input.lastname))
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data,
      })

      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: "UPDATE",
        resource: "USER",
        resourceId: String(userId),
        metadata: { updatedFields: Object.keys(input) },
      })

      return { id: user.id, updatedAt: user.updatedAt.toISOString() }
    })
  },

  /**
   * Mark terms of service as accepted by user.
   * Sets hasSignedTerms = true and logs audit entry.
   * @async
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  async acceptTerms(userId: number) {
    return prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { hasSignedTerms: true },
      })
      await auditService.logWithTx(tx, {
        userId,
        action: "UPDATE",
        resource: "USER",
        resourceId: String(userId),
        metadata: { field: "hasSignedTerms", value: true },
      })
    })
  },

  /**
   * Mark data policy as accepted and set update timestamp.
   * Called when user acknowledges updated privacy policy.
   * @async
   * @param {number} userId - User ID
   * @returns {Promise<void>}
   */
  async acceptDataPolicy(userId: number) {
    return prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          needDataPolicyUpdate: false,
          dataPolicyUpdate: new Date(),
        },
      })
      await auditService.logWithTx(tx, {
        userId,
        action: "UPDATE",
        resource: "USER",
        resourceId: String(userId),
        metadata: { field: "dataPolicyUpdate" },
      })
    })
  },

  /**
   * Get user's custom day moments (meal times, etc.).
   * Ordered by start time.
   * @async
   * @param {number} userId - User ID
   * @returns {Promise<Array<Object>>} UserDayMoment records sorted by startTime
   */
  async getDayMoments(userId: number) {
    return prisma.userDayMoment.findMany({
      where: { userId },
      orderBy: { startTime: "asc" },
    })
  },

  /**
   * Replace all day moments for a user.
   * Deletes old records and creates new ones in one transaction.
   * @async
   * @param {number} userId - User ID
   * @param {Array<Object>} moments - New moments (type, startTime, endTime in HH:MM format)
   * @returns {Promise<Array<Object>>} Created UserDayMoment records
   * @example
   * await userService.updateDayMoments(userId, [
   *   { type: 'morning', startTime: '06:00', endTime: '12:00' },
   *   { type: 'noon', startTime: '12:00', endTime: '18:00' }
   * ])
   */
  async updateDayMoments(
    userId: number,
    moments: { type: string; startTime: string; endTime: string }[],
  ) {
    return prisma.$transaction(async (tx) => {
      await tx.userDayMoment.deleteMany({ where: { userId } })

      const created = await Promise.all(
        moments.map((m) =>
          tx.userDayMoment.create({
            data: {
              userId,
              type: m.type as "morning" | "noon" | "evening" | "night" | "custom",
              startTime: new Date(`1970-01-01T${m.startTime}:00Z`),
              endTime: new Date(`1970-01-01T${m.endTime}:00Z`),
            },
          }),
        ),
      )

      await auditService.logWithTx(tx, {
        userId,
        action: "UPDATE",
        resource: "USER",
        resourceId: String(userId),
        metadata: { field: "dayMoments", count: moments.length },
      })

      return created
    })
  },
}
