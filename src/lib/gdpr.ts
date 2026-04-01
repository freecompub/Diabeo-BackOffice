import { prisma } from "@/lib/db/client"

/**
 * Check if a user has given GDPR consent.
 * Without consent, medical data must not be processed.
 * Used by routes that access patient health data.
 */
export async function requireGdprConsent(userId: number): Promise<boolean> {
  const settings = await prisma.userPrivacySettings.findUnique({
    where: { userId },
    select: { gdprConsent: true },
  })

  return settings?.gdprConsent === true
}
