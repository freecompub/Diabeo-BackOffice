import type { Sex, Language, Role } from "@prisma/client"

/**
 * Fields encrypted with AES-256-GCM in the database.
 * Note: birthday is DateTime in schema (not encrypted) — handled separately.
 * Note: email is encrypted but NOT updatable (M9).
 */
export const ENCRYPTED_USER_FIELDS = [
  "email",
  "firstname",
  "firstnames",
  "usedFirstname",
  "lastname",
  "usedLastname",
  "phone",
  "address1",
  "address2",
  "cp",
  "city",
  "nirpp",
  "nirppPolicyholder",
  "ins",
  "codeBirthPlace",
] as const

export type EncryptedUserField = (typeof ENCRYPTED_USER_FIELDS)[number]

/** Fields never exposed in API responses */
export const INTERNAL_USER_FIELDS = [
  "passwordHash",
  "intercomHash",
  "deploymentKey",
  "oid",
  "debug",
] as const

/** Public account profile returned by GET /api/account */
export interface AccountUser {
  id: number
  email: string
  title: string | null
  firstname: string | null
  lastname: string | null
  birthday: string | null
  sex: Sex | null
  timezone: string | null
  phone: string | null
  address1: string | null
  address2: string | null
  cp: string | null
  city: string | null
  country: string | null
  pic: string | null
  language: Language | null
  role: Role
  hasSignedTerms: boolean
  profileComplete: boolean
  needOnboarding: boolean
  mfaEnabled: boolean
  createdAt: string
}

/** Fields allowed for update via PUT /api/account (email NOT updatable) */
export interface UpdateAccountInput {
  title?: string
  firstname?: string
  firstnames?: string
  usedFirstname?: string
  lastname?: string
  usedLastname?: string
  birthday?: string
  sex?: Sex
  timezone?: string
  phone?: string
  address1?: string
  address2?: string
  cp?: string
  city?: string
  country?: string
  language?: Language
}
