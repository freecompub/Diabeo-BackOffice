/**
 * US-2076-UI iter 1 (foundation) — Page Messagerie pro `/messages`.
 *
 * Server component minimal :
 *   - Gate VIEWER bounce → /login (page pro NURSE+ uniquement via layout
 *     `(dashboard)` mais defense-in-depth ici car patient ne doit pas
 *     atterrir sur cette page même si lien partagé par erreur)
 *   - Audit accessDenied si rôle insuffisant (US-2265 burst detection)
 *   - Render `<MessagingInbox>` client component qui contient toute la
 *     logique state + polling (2-column responsive, thread list + viewer)
 *
 * **Backend déjà disponible** (US-2076 scope A — PR #412) :
 *   - GET  `/api/messages` — liste threads
 *   - GET  `/api/messages/thread/[conversationKey]` — thread messages
 *   - POST `/api/messages` — send (encrypt + FCM)
 *   - PUT  `/api/messages/[id]/read` — markRead
 *   - GET  `/api/messages/unread-count` — badge polling
 *
 * **Sécurité** :
 *   - `force-dynamic` + Cache-Control no-store (page PHI, défini par
 *     middleware via `setAppointmentSecurityHeaders` pattern ou directement
 *     dans le HTML response — TODO V1.5 si besoin d'un wrapper réutilisable)
 *   - `requireGdprConsent` server-side avec redirect privacy
 *   - PHI jamais en URL : `conversationKey` reste en query string client-only
 *
 * **iter 1 scope** :
 *   - Foundation : layout shell + sidebar item + badge unread polling
 *   - Pas encore : thread list (iter 2), viewer/composer (iter 3),
 *     new thread modal (iter 4), polish a11y (iter 5)
 *
 * @see docs/UserStory/pro-user-stories/08-messagerie-notifs/US-2076-UI-messagerie-inbox-pro.md
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { isKnownRoleString, resolveHomeForRole } from "@/lib/auth/role-home"
import { requireGdprConsent } from "@/lib/gdpr"
import { auditService } from "@/lib/services/audit.service"
import { MessagingInbox } from "@/components/diabeo/messaging/MessagingInbox"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function MessagesPage() {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  const userIdStr = headersList.get("x-user-id")
  const ipAddress = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
  const userAgent = headersList.get("user-agent") ?? "unknown"
  const requestId = headersList.get("x-request-id") ?? "no-request-id"
  const ctx = { ipAddress, userAgent, requestId }

  if (!isKnownRoleString(role) || !userIdStr) redirect("/login")

  // Fix M4 + M6 round 1 review PR #440 — regex strict + Number.isSafeInteger
  // (defense-in-depth — middleware doit déjà valider).
  if (!/^\d+$/.test(userIdStr)) redirect("/login")
  const userId = Number.parseInt(userIdStr, 10)
  if (!Number.isSafeInteger(userId) || userId <= 0) redirect("/login")

  // Defense-in-depth : page messagerie destinée aux pros (NURSE+). VIEWER
  // (patient) a son propre flux inbox dans l'app iOS (UI patient web V2+).
  // Fix L10 round 1 review PR #440 — `resourceId: "messages-inbox"` (pattern
  // US-2268 forensique CNIL/ANS) plutôt que `String(userId)` qui est l'ID
  // de l'attaquant lui-même (déjà capturé dans `userId` field).
  if (role === "VIEWER") {
    await auditService.accessDenied({
      userId, resource: "MESSAGE", resourceId: "messages-inbox",
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { endpoint: "/messages", attemptedRole: role, reason: "viewer_pro_inbox_forbidden" },
    }).catch(() => { /* fire-and-forget */ })
    redirect(resolveHomeForRole(role))
  }

  // Consent RGPD Art. 9 — messagerie = donnée santé (échange clinique).
  // Fix M2 round 1 review PR #440 — redirect param est un chemin interne
  // hardcodé `/messages` (pas user-controlled), donc pas de risque open-
  // redirect ici. TODO : créer la page `/account/privacy` (route API
  // existe, UI manquante). En attendant, redirect vers home rôle pour ne
  // pas atterrir sur un 404 (UX + RGPD Art. 7.3).
  const hasConsent = await requireGdprConsent(userId)
  if (!hasConsent) {
    await auditService.log({
      userId, action: "READ", resource: "MESSAGE", resourceId: String(userId),
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, requestId: ctx.requestId,
      metadata: { kind: "messages.consent_required", endpoint: "/messages" },
    }).catch(() => { /* fire-and-forget */ })
    redirect(resolveHomeForRole(role))
  }

  const t = await getTranslations("messages")

  return (
    <main
      className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden"
      aria-labelledby="messages-page-title"
    >
      {/* Skip-link cohérent pattern US-2500-UI iter 10 (WCAG 2.4.1). */}
      <a
        href="#messages-inbox-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded focus:bg-teal-800 focus:px-3 focus:py-2 focus:text-white focus-visible:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        {t("skipToInbox")}
      </a>
      <header className="border-b border-border px-4 py-3 lg:px-6">
        <h1 id="messages-page-title" className="text-2xl font-semibold">
          {t("pageTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pageSubtitle")}
        </p>
      </header>
      <div id="messages-inbox-content" className="flex-1 overflow-hidden">
        <MessagingInbox userId={userId} userRole={role} />
      </div>
    </main>
  )
}
