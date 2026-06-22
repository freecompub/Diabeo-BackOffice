export type GreetingNameParts = {
  title: string | null
  firstname: string | null
  lastname: string | null
}

/**
 * Pure name formatter for the dashboard greeting. Prefers `"{title} {lastname}"`
 * (e.g. "Dr Martin"); the honorific is a FR label, so it is only prefixed for
 * `fr`/`en` — other locales (`ar`) get the bare name to avoid a Latin honorific
 * inside a translated/RTL greeting. Falls back to firstname, then `null` (the
 * caller then renders the date alone).
 *
 * Kept in a dependency-free module (no next/headers, no Prisma) so it is unit
 * testable in isolation.
 */
export function buildGreetingName(
  name: GreetingNameParts | null,
  locale: string,
): string | null {
  if (!name) return null
  if (name.lastname) {
    const useTitle = locale === "fr" || locale === "en"
    return `${useTitle && name.title ? `${name.title} ` : ""}${name.lastname}`
  }
  return name.firstname ?? null
}
