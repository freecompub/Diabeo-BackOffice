import { headers } from "next/headers"
import { getLocale } from "next-intl/server"
import { CABINET_TIMEZONE } from "@/lib/cabinet-time"
import { getCurrentUserDisplayName } from "@/lib/auth/current-user-name"
import { buildGreetingName } from "./greeting-name"

interface DashboardGreetingProps {
  /** Already-translated page title, rendered as the h1. */
  title: string
  /** Formats the greeting for a name, e.g. `(n) => t("greeting", { name: n })`. */
  greeting: (name: string) => string
  /**
   * Contenu additionnel appondu au sous-titre après « · » (ex. compteurs de
   * triage du médecin : « 7 patients à trier · 3 alertes prioritaires »).
   * Optionnel — les autres rôles gardent « {greeting} · {date} ».
   */
  subtitleExtra?: React.ReactNode
}

/**
 * Editorial dashboard header (Home v3) shared by the per-role home pages
 * (medecin, infirmier, …) to avoid drift: Fraunces `<h1>` + a
 * "{greeting} · {date}" subtitle.
 *
 * The date is pinned to `Europe/Paris` (`CABINET_TIMEZONE`) so it never drifts
 * to the previous day in the server's UTC zone late at night.
 *
 * The name is the **signed-in user's own** name (self lookup, request-cached,
 * non-audited — see `getCurrentUserDisplayName`), NOT the dashboard subject.
 * A doctor viewing `/infirmier` is therefore greeted by their own name; this
 * is intended (the greeting answers "who is logged in").
 */
export async function DashboardGreeting({
  title,
  greeting,
  subtitleExtra,
}: DashboardGreetingProps) {
  const locale = await getLocale()
  const today = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: CABINET_TIMEZONE,
  }).format(new Date())
  const todayLabel =
    locale === "fr" || locale === "en"
      ? today.charAt(0).toUpperCase() + today.slice(1)
      : today

  const headersList = await headers()
  const rawUserId = headersList.get("x-user-id")
  const userId = rawUserId ? Number(rawUserId) : NaN
  const name =
    Number.isInteger(userId) && userId > 0
      ? await getCurrentUserDisplayName(userId)
      : null
  const greetingName = buildGreetingName(name, locale)
  const subtitle = greetingName
    ? `${greeting(greetingName)} · ${todayLabel}`
    : todayLabel

  return (
    <header>
      <h1 className="font-display text-3xl font-semibold tracking-tight">
        {title}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {subtitle}
        {subtitleExtra && <> · {subtitleExtra}</>}
      </p>
    </header>
  )
}
