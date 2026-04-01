import { prisma } from "@/lib/db/client"
import { encrypt, decrypt } from "@/lib/crypto/health-data"
import { auditService } from "./audit.service"
import type { Prisma } from "@prisma/client"
import type { AccountUser, UpdateAccountInput } from "@/types/user"
import { ENCRYPTED_USER_FIELDS, type EncryptedUserField } from "@/types/user"

/** Encrypt a string field to base64 for storage */
function encryptField(value: string): string {
  return Buffer.from(encrypt(value)).toString("base64")
}

/** Decrypt a base64-encoded encrypted field — never return ciphertext */
function safeDecryptField(value: string | null): string | null {
  if (!value) return null
  try {
    return decrypt(new Uint8Array(Buffer.from(value, "base64")))
  } catch {
    return null
  }
}

const ENCRYPTED_SET = new Set<string>(ENCRYPTED_USER_FIELDS)

function isEncryptedField(field: string): field is EncryptedUserField {
  return ENCRYPTED_SET.has(field)
}

export const userService = {
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

  async getDayMoments(userId: number) {
    return prisma.userDayMoment.findMany({
      where: { userId },
      orderBy: { startTime: "asc" },
    })
  },

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
