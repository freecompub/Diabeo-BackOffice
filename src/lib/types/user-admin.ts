/**
 * Types partagés pour US-2148 (Admin users) UI.
 *
 * Pattern aligné PR #457-#460 (`src/lib/types/*-admin.ts`).
 * Backend DTO : `user-management.service.ts:AdminUserView`.
 */

export type Role = "ADMIN" | "DOCTOR" | "NURSE" | "VIEWER"
export type UserStatus = "active" | "suspended" | "archived"

/**
 * Fix H4 round 1 review PR #461 — ordre stable (hiérarchique) pour itération
 * UI (vs `Object.entries(ROLE_LABELS_FR)` qui dépend ordre d'insertion JS).
 * Régression-proof : si refactor passe par Map/serializer, ordre cassé.
 */
export const ROLES_ORDERED: ReadonlyArray<Role> = ["ADMIN", "DOCTOR", "NURSE", "VIEWER"]
export const USER_STATUSES_ORDERED: ReadonlyArray<UserStatus> = ["active", "suspended", "archived"]

const ROLES: ReadonlySet<Role> = new Set(ROLES_ORDERED)
const STATUSES: ReadonlySet<UserStatus> = new Set(USER_STATUSES_ORDERED)

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.has(value as Role)
}

export function isUserStatus(value: unknown): value is UserStatus {
  return typeof value === "string" && STATUSES.has(value as UserStatus)
}

/**
 * AdminUserView côté client — Dates Prisma → ISO string via JSON serialize.
 * Email + firstname + lastname déchiffrés côté backend AVANT envoi
 * (cf. PR #409 `toAdminView`). UI affiche en clair (ADMIN screen).
 */
export interface AdminUserDTOClient {
  id: number
  email: string | null
  firstname: string | null
  lastname: string | null
  role: Role
  status: UserStatus
  statusChangedAt: string | null
  mfaEnabled: boolean
  language: string | null
  createdAt: string
  updatedAt: string
}

export const ROLE_LABELS_FR: Record<Role, string> = {
  ADMIN: "Administrateur",
  DOCTOR: "Médecin",
  NURSE: "Infirmier·ère",
  VIEWER: "Patient",
}

export const USER_STATUS_LABELS_FR: Record<UserStatus, string> = {
  active: "Actif",
  suspended: "Suspendu",
  archived: "Archivé",
}

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

export const ROLE_VARIANT: Record<Role, BadgeVariant> = {
  ADMIN: "destructive",
  DOCTOR: "default",
  NURSE: "secondary",
  VIEWER: "outline",
}

export const USER_STATUS_VARIANT: Record<UserStatus, BadgeVariant> = {
  active: "default",
  suspended: "outline",
  archived: "secondary",
}

export function getRoleLabel(role: Role | string): string {
  if (isRole(role)) return ROLE_LABELS_FR[role]
  if (process.env.NODE_ENV !== "production") console.warn(`[user-admin] Unknown Role: ${role}`)
  return role
}

export function getUserStatusLabel(status: UserStatus | string): string {
  if (isUserStatus(status)) return USER_STATUS_LABELS_FR[status]
  if (process.env.NODE_ENV !== "production") console.warn(`[user-admin] Unknown UserStatus: ${status}`)
  return status
}

export function getRoleVariant(role: Role | string): BadgeVariant {
  if (isRole(role)) return ROLE_VARIANT[role]
  return "outline"
}

export function getUserStatusVariant(status: UserStatus | string): BadgeVariant {
  if (isUserStatus(status)) return USER_STATUS_VARIANT[status]
  return "outline"
}

/**
 * Affichage nom complet — fallback email si nom non saisi.
 * Format "Lastname Firstname" (français formel).
 */
export function getUserDisplayName(user: Pick<AdminUserDTOClient, "firstname" | "lastname" | "email" | "id">): string {
  const parts: string[] = []
  if (user.lastname) parts.push(user.lastname)
  if (user.firstname) parts.push(user.firstname)
  if (parts.length > 0) return parts.join(" ")
  return user.email ?? `User #${user.id}`
}

// ─────────────────────────────────────────────────────────────
// Tax Rules (US-2110 — config tax-rules)
// ─────────────────────────────────────────────────────────────

export const TAX_TYPES = ["VAT", "INCOME_TAX", "CORPORATE_TAX", "SOCIAL_CONTRIBUTION"] as const
export type TaxType = (typeof TAX_TYPES)[number]

export const TAX_TYPE_LABELS_FR: Record<TaxType, string> = {
  VAT: "TVA",
  INCOME_TAX: "Impôt sur le revenu",
  CORPORATE_TAX: "Impôt sur les sociétés",
  SOCIAL_CONTRIBUTION: "Cotisation sociale",
}

export interface TaxRuleDTOClient {
  id: number
  countryCode: string
  taxType: TaxType
  baseRate: number // 0..1
  description: string | null
  appliesFrom: string
  appliesUntil: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Formate baseRate 0..1 en pourcentage locale-aware (0.20 → "20 %").
 */
export function formatTaxRate(rate: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(rate)
}

/**
 * Fix M6 round 1 review PR #461 — date locale-aware (vs `new Date().toISOString()`
 * qui force UTC). Évite "demain" par défaut si client après minuit UTC mais
 * avant minuit local (Paris CEST 01h30).
 */
export function getLocalIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}
