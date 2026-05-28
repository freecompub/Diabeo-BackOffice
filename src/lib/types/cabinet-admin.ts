/**
 * Types partagés pour US-2117/2118 (Cabinet enrichi) + US-2506 (SMS config) UI.
 *
 * Fix H2 round 1 review PR #459 — extraction DRY (vs DTOs inline dans
 * CabinetsListClient + CabinetDetailClient). Cohérent pattern PR #458
 * `src/lib/types/admin-ops.ts` + PR #457 `src/lib/types/data-breach.ts`.
 *
 * Backend DTOs : `cabinet-settings.service.ts:CabinetSettingsDTO` + `sms.service.ts:SmsConfig`.
 * Aligné `prisma/schema.prisma` enum `ServiceType` (3 valeurs).
 */

// ─────────────────────────────────────────────────────────────
// ServiceType (Prisma enum) — 3 valeurs réelles backend
// ─────────────────────────────────────────────────────────────

export type ServiceType = "clinic" | "hospital" | "freelance"

const SERVICE_TYPES: ReadonlySet<ServiceType> = new Set(["clinic", "hospital", "freelance"])

export function isServiceType(value: unknown): value is ServiceType {
  return typeof value === "string" && SERVICE_TYPES.has(value as ServiceType)
}

export const SERVICE_TYPE_LABELS_FR: Record<ServiceType, string> = {
  clinic: "Clinique",
  hospital: "Hôpital",
  freelance: "Cabinet libéral",
}

// ─────────────────────────────────────────────────────────────
// CabinetSettingsDTO (manager-level fields + read-only régaliens)
// ─────────────────────────────────────────────────────────────

export interface CabinetSettingsDTOClient {
  id: number
  name: string
  establishment: string | null
  phone: string | null
  email: string | null
  website: string | null
  addressLine1: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  country: string | null
  /** Prisma.JsonValue — picker structuré V1.5. */
  openingHours: unknown
  specialties: string[]
  capacity: number | null
  noVideos: boolean
  noFood: boolean
  managerId: number | null
  /** Champs régaliens (read-only côté manager — modifiables admin via /api/admin/healthcare-services). */
  siret: string | null
  tvaIntra: string | null
  type: ServiceType | string
}

/**
 * Shape pour liste (subset de DTO complet + sms fields).
 * Backend `/api/admin/healthcare-services` retourne en ligne.
 */
export interface HealthcareServiceListItem {
  id: number
  name: string
  type: ServiceType | string
  city: string | null
  establishment: string | null
  smsEnabled: boolean
  smsCreditBalance: number
  managerId: number | null
}

// ─────────────────────────────────────────────────────────────
// SMS Config (US-2506 V1 mock)
// ─────────────────────────────────────────────────────────────

export interface SmsConfigDTOClient {
  smsEnabled: boolean
  smsCreditBalance: number
}

/**
 * Fix L4 round 1 review PR #459 — const partagée backend/UI.
 * Aligné Zod backend `sms-config/route.ts` (`z.number().int().nonnegative().max(1_000_000)`).
 */
export const SMS_CREDITS_MAX = 1_000_000

// ─────────────────────────────────────────────────────────────
// Validation bornes UI (alignées Zod backend cabinet-settings)
// ─────────────────────────────────────────────────────────────

export const CABINET_FIELD_LIMITS = {
  PHONE_MAX: 30,
  EMAIL_MAX: 255,
  WEBSITE_MAX: 500,
  ADDRESS_MAX: 255,
  POSTAL_CODE_MAX: 10,
  CITY_MAX: 100,
  CAPACITY_MAX: 10_000,
  SPECIALTIES_COUNT_MAX: 20,
  /** Fix M1 round 1 review PR #459 — backend Zod `z.string().max(60)` par item. */
  SPECIALTY_LEN_MAX: 60,
} as const
