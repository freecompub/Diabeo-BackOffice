/**
 * @module consultation.service
 * @description US-2018b — Consultation patient en overlay éphémère.
 *
 * Émet et résout une **référence patient éphémère** (jeton opaque `cTok`) le
 * temps qu'un professionnel garde le workspace patient ouvert. Propriétés :
 *
 * - **Aucun id patient dans l'URL** : le client ne manipule que `publicRef`
 *   (UUID opaque) à l'ouverture, puis le jeton `cTok` (en-tête XHR) pour lire
 *   les données. L'`id` patient interne ne quitte jamais le serveur.
 * - **Non partageable** : `cTok` est lié à l'utilisateur émetteur ; présenté par
 *   un autre utilisateur, il est refusé.
 * - **Éphémère / non rejouable** : TTL court glissant (rafraîchi à chaque lecture),
 *   détruit à la fermeture (`close`, best-effort via `sendBeacon`) — sinon expire.
 * - **Single-active** : ouvrir un patient invalide le jeton actif précédent de
 *   l'utilisateur (au plus une consultation ouverte par utilisateur, pas
 *   d'accumulation Redis).
 *
 * Stockage : Redis (Upstash) via {@link cacheSet}/{@link cacheGet}/{@link cacheDelete}.
 *
 * ⚠️ CONTRAINTE PROD (review M2/HSA) — la couche `redis-cache` est *fail-open* :
 * sur panne Redis, `cacheDelete` est un no-op silencieux et le `memoryFallback`
 * n'est utilisé QUE si Redis n'est pas configuré. Ici Redis EST la source de
 * vérité du jeton (pas de fallback DB). Donc :
 *   - la prod DOIT avoir Redis configuré et disponible ; en multi-réplicas,
 *     `memoryFallback` (Redis absent) casserait la résolution inter-instances ;
 *   - si une suppression Redis échoue, la garantie « non rejouable au close »
 *     dégrade vers « expire au pire au plafond absolu » ({@link CONSULTATION_ABSOLUTE_MAX_S}).
 * Le binding `userId` + le plafond absolu bornent le risque résiduel (pas
 * d'escalade : le jeton ne résout que vers un patient déjà autorisé).
 *
 * Audit HDS préservé côté serveur : chaque ouverture trace le patient consulté.
 */

import { randomUUID } from "crypto"
import type { Role } from "@prisma/client"
import { canAccessPatient } from "@/lib/access-control"
import { cacheDelete, cacheGet, cacheSet } from "@/lib/cache/redis-cache"
import { prisma } from "@/lib/db/client"
import { auditService, type AuditContext } from "@/lib/services/audit.service"

/** TTL du jeton (secondes) — glissant, rafraîchi à chaque résolution (idle). */
export const CONSULTATION_TTL_S = 15 * 60
/** Plafond de durée de vie ABSOLU (secondes), TTL glissant ou non. Évite qu'un
 * onglet oublié sur un poste partagé maintienne un jeton indéfiniment (ANSSI). */
export const CONSULTATION_ABSOLUTE_MAX_S = 60 * 60

const TOKEN_BUCKET = "consultation"
/** Pointeur "jeton actif courant" par utilisateur (pour le single-active). */
const ACTIVE_BUCKET = "consultation-active"

interface ConsultationToken {
  userId: number
  patientId: number
  /** Epoch ms d'émission — borne la durée de vie absolue (cap), indépendamment
   * du TTL glissant. */
  createdAt: number
}

/**
 * Ouvre une consultation : résout `publicRef → id`, vérifie l'accès (RBAC),
 * invalide le jeton actif précédent de l'utilisateur, émet un nouveau `cTok`
 * et audite l'accès patient.
 *
 * @returns `{ cTok }` en cas de succès, ou `{ error }` (`patientNotFound` couvre
 *   aussi "hors portefeuille" — réponse neutre anti-énumération).
 */
export async function openConsultation(
  userId: number,
  role: Role,
  publicRef: string,
  ctx?: AuditContext,
): Promise<{ cTok: string; patientId: number } | { error: "patientNotFound" }> {
  // Résolution opaque : publicRef (UUID) → id interne, jamais l'inverse exposé.
  const patient = await prisma.patient.findFirst({
    where: { publicRef, deletedAt: null },
    select: { id: true },
  })
  if (!patient) return { error: "patientNotFound" }

  const allowed = await canAccessPatient(userId, role, patient.id)
  if (!allowed) return { error: "patientNotFound" } // neutre : ne distingue pas inexistant / hors périmètre

  // Single-active : révoque le jeton précédent de cet utilisateur.
  const previous = await cacheGet<string>(ACTIVE_BUCKET, String(userId))
  if (previous) await cacheDelete(TOKEN_BUCKET, previous)

  const cTok = randomUUID()
  const value: ConsultationToken = { userId, patientId: patient.id, createdAt: Date.now() }
  await cacheSet(TOKEN_BUCKET, cTok, value, CONSULTATION_TTL_S)
  await cacheSet(ACTIVE_BUCKET, String(userId), cTok, CONSULTATION_TTL_S)

  await auditService.log({
    userId,
    action: "READ",
    resource: "PATIENT",
    resourceId: String(patient.id),
    ipAddress: ctx?.ipAddress,
    userAgent: ctx?.userAgent,
    metadata: { patientId: patient.id, kind: "consultation.open" },
  })

  return { cTok, patientId: patient.id }
}

/**
 * Résout un `cTok` en `patientId`, **uniquement** s'il appartient à l'utilisateur
 * appelant (binding anti-partage). Rafraîchit le TTL (glissant) à chaque appel
 * pour qu'une consultation active ne s'expire pas pendant son usage.
 *
 * @returns le `patientId` ou `null` (jeton inconnu/expiré/non lié à l'utilisateur).
 */
export async function resolveConsultation(cTok: string, userId: number): Promise<number | null> {
  const value = await cacheGet<ConsultationToken>(TOKEN_BUCKET, cTok)
  if (!value || value.userId !== userId) return null

  // Plafond absolu : au-delà, on refuse ET on révoque, même si le TTL glissant
  // est frais (poste partagé, onglet oublié).
  if (Date.now() - value.createdAt > CONSULTATION_ABSOLUTE_MAX_S * 1000) {
    await cacheDelete(TOKEN_BUCKET, cTok)
    return null
  }

  // TTL glissant : ré-écrit la valeur avec un TTL frais (createdAt préservé).
  await cacheSet(TOKEN_BUCKET, cTok, value, CONSULTATION_TTL_S)
  await cacheSet(ACTIVE_BUCKET, String(userId), cTok, CONSULTATION_TTL_S)
  return value.patientId
}

/**
 * Ferme une consultation : invalide le jeton (idempotent). Appelé sur clic
 * « Fermer » ET via `navigator.sendBeacon` au déchargement de la page.
 */
export async function closeConsultation(cTok: string, userId: number): Promise<void> {
  const value = await cacheGet<ConsultationToken>(TOKEN_BUCKET, cTok)
  // C1 (review) — ne supprime le jeton QUE s'il appartient à l'appelant. Sans
  // ce gate, un utilisateur authentifié présentant le cTok d'un autre pourrait
  // invalider sa consultation (DoS inter-utilisateur). Jeton non possédé ⇒
  // no-op (close reste idempotent).
  if (!value || value.userId !== userId) return
  await cacheDelete(TOKEN_BUCKET, cTok)
  const active = await cacheGet<string>(ACTIVE_BUCKET, String(userId))
  if (active === cTok) await cacheDelete(ACTIVE_BUCKET, String(userId))
}
