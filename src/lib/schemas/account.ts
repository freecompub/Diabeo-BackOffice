/**
 * @module schemas/account
 * @description Shared Zod schemas for /api/account routes.
 * @see src/lib/schemas/auth.ts — same single-source-of-truth pattern.
 */

import { z } from "zod"
import { Pathology, Sex, Language } from "@prisma/client"

/** PUT /api/patient body (patient profile patch — pathology only). */
export const patientProfilePatchSchema = z.object({
  pathology: z.enum(Pathology).optional(),
})
export type PatientProfilePatch = z.infer<typeof patientProfilePatchSchema>

/** PUT /api/account body (user profile patch — all optional). */
export const userProfilePatchSchema = z.object({
  title: z.string().max(10).optional(),
  firstname: z.string().min(1).max(100).optional(),
  firstnames: z.string().max(200).optional(),
  usedFirstname: z.string().max(100).optional(),
  lastname: z.string().min(1).max(100).optional(),
  usedLastname: z.string().max(100).optional(),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sex: z.enum(Sex).optional(),
  timezone: z.string().max(50).optional(),
  phone: z.string().max(20).optional(),
  address1: z.string().max(200).optional(),
  address2: z.string().max(200).optional(),
  cp: z.string().max(10).optional(),
  city: z.string().max(100).optional(),
  country: z.string().length(2).optional(),
  language: z.enum(Language).optional(),
})
export type UserProfilePatch = z.infer<typeof userProfilePatchSchema>

/** Privacy / GDPR preferences — full shape (GET response, PUT partial). */
export const privacySettingsSchema = z.object({
  gdprConsent: z.boolean(),
  shareWithProviders: z.boolean(),
  shareWithResearchers: z.boolean(),
  analyticsEnabled: z.boolean(),
})
export type PrivacySettings = z.infer<typeof privacySettingsSchema>

/** PUT /api/account/privacy body (partial update). */
export const privacySettingsPatchSchema = privacySettingsSchema.partial()
export type PrivacySettingsPatch = z.infer<typeof privacySettingsPatchSchema>
