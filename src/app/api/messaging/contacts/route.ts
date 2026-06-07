/**
 * @route /api/messaging/contacts
 * @description Fix HSA H2 round 1 review PR #444 — endpoint listant les
 * contacts MESSAGEABLES uniquement (filtre `canMessage` côté backend).
 *
 * **Motivation** : `useMessagingContacts` UI (iter 4) faisait fetch
 * `/api/patients` (tous les patients NURSE+) puis backend rejetait au
 * POST `/api/messages` si `canMessage` refusait (consent revoqué, lien
 * cabinet rompu). UX dégradée + fuite préférence patient (Art. 7 RGPD).
 *
 * Cette route filtre AVANT exposition UI : retourne uniquement les
 * patients pour lesquels `canMessage(user.id, patient.userId)` retourne
 * allowed:true.
 *
 * **Performance** : O(N) appels `canMessage` (4 queries DB chacune).
 * Acceptable car N capped par `MAX_CONTACTS_PER_QUERY` (50). Au-delà,
 * V1.5 introduira un cache Redis pré-calculé.
 *
 * **Anonymisation** : retourne `Patient #N` uniquement (cohérent iter 2).
 * Iter futur résoudra le vrai nom (Issue #442 UUID opaques).
 *
 * **Audit** : 1 row `READ MESSAGING_CONTACTS` (pas de pivot patientId —
 * vue agrégée multi-patients).
 *
 * **RBAC** : NURSE+ (cohérent `/api/patients`).
 */

import { NextResponse, type NextRequest } from "next/server"
import { AuthError, requireRole } from "@/lib/auth"
import { extractRequestContext, auditService } from "@/lib/services/audit.service"
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { requireGdprConsent } from "@/lib/gdpr"
import { patientService } from "@/lib/services/patient.service"
import { canMessage } from "@/lib/services/messaging.service"

/** Cap appels `canMessage` parallèles (perf + anti-DoS). */
const MAX_CONTACTS_PER_QUERY = 50

interface MessagingContactDTO {
  patientId: number
  userId: number
  /** Anonymized — `Patient #{patientId}`. */
  displayName: string
}

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const user = requireRole(req, "NURSE")
    // Consent RGPD Art. 9 sur émetteur (cohérent /api/messages POST).
    const hasConsent = await requireGdprConsent(user.id)
    if (!hasConsent) {
      return NextResponse.json({ error: "gdprConsentRequired" }, { status: 403 })
    }

    // 1. Fetch portefeuille patients du PS (déjà décrypté).
    const patients = await patientService.listByDoctor(user.id, user.id)

    // 2. Filter via canMessage — cap N pour éviter DoS si portefeuille
    //    énorme (>>50 patients par PS = cabinet atypique, V1.5 paginer).
    const capped = patients.slice(0, MAX_CONTACTS_PER_QUERY)
    const checks = await Promise.all(
      capped.map(async (p) => {
        const userId = p.user.id
        if (typeof userId !== "number") return null
        try {
          const result = await canMessage(user.id, userId)
          if (!result.allowed) return null
          return {
            patientId: p.id,
            userId,
            displayName: `Patient #${p.id}`,
          } as MessagingContactDTO
        } catch {
          // Si canMessage throw (DB transient), skip le contact silencieusement
          // — UX dégradée OK vs 500 complet inbox.
          return null
        }
      }),
    )
    const contacts = checks.filter((c): c is MessagingContactDTO => c !== null)

    // 3. Audit aggregate — pas de pivot patientId (vue multi-patients).
    await auditService.log({
      userId: user.id,
      action: "READ",
      resource: "MESSAGE",
      resourceId: "messaging-contacts",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        kind: "messaging.contacts.list",
        portfolioSize: patients.length,
        messageable: contacts.length,
        capped: patients.length > MAX_CONTACTS_PER_QUERY,
      },
    }).catch(() => { /* fire-and-forget */ })

    return NextResponse.json(
      { items: contacts },
      {
        headers: {
          // Anti-cache : preferences messagerie peuvent changer (consent).
          "Cache-Control": "no-store, private",
        },
      },
    )
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "messaging/contacts GET", ctx.requestId)
  }
}
