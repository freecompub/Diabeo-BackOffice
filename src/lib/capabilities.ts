/**
 * @module capabilities
 * @description Socle d'accès « 2 axes » (US-2610 / F4 / F2) — lecture des capacités
 * scopées et résolution de la politique de vérification PS.
 *
 * **Q1 (clinique, PHI)** et **Q2 (gestion)** sont portées par `HealthcareMembership`
 * (N-N user↔service). Ces helpers **lisent la base** (jamais le JWT) → ils préparent
 * la révocation immédiate (F7, PR2). ⚠️ **PR1 : additifs, PAS encore branchés dans
 * l'enforcement** (`canAccessPatient`/`isOrgMember`/`requireRole` restent inchangés).
 *
 * `resolveVerificationPolicy` est **fail-secure** : défaut `required` codé en dur ;
 * `provisional` n'est honoré que borné (`expiresAt` futur) et hors production (sauf
 * flag pilote documenté). Réglé par `SYSTEM_ADMIN` uniquement (jamais l'org-admin).
 */

import type { Role, HealthcareMembership } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { getEnvBoolean } from "@/lib/env"

/** Toutes les appartenances scopées d'un user (capacités Q1/Q2 par service). */
export async function getMemberships(userId: number): Promise<HealthcareMembership[]> {
  return prisma.healthcareMembership.findMany({ where: { userId } })
}

/**
 * Capacité clinique (Q1) du user dans un service donné, ou `null` si aucun accès
 * PHI via ce scope. (Source unique : `HealthcareMembership.clinicalRole`.)
 */
export async function clinicalCapability(userId: number, serviceId: number): Promise<Role | null> {
  const m = await prisma.healthcareMembership.findUnique({
    where: { userId_serviceId: { userId, serviceId } },
    select: { clinicalRole: true },
  })
  return m?.clinicalRole ?? null
}

/** Capacité de gestion (Q2) opérationnelle du user dans un service. */
export async function canManageOrg(userId: number, serviceId: number): Promise<boolean> {
  const m = await prisma.healthcareMembership.findUnique({
    where: { userId_serviceId: { userId, serviceId } },
    select: { canManage: true },
  })
  return m?.canManage ?? false
}

/** Admin principal (Q2 + droit de déléguer Q2) du user dans un service. */
export async function isPrincipalAdmin(userId: number, serviceId: number): Promise<boolean> {
  const m = await prisma.healthcareMembership.findUnique({
    where: { userId_serviceId: { userId, serviceId } },
    select: { isPrincipalAdmin: true },
  })
  return m?.isPrincipalAdmin ?? false
}

/** Un scope de gestion (Q2) : le service managé + son libellé d'affichage. */
export type ManagementScope = {
  serviceId: number
  serviceName: string
  isPrincipalAdmin: boolean
}

/**
 * Liste les services où le user a la **capacité de gestion (Q2)** — base de la
 * sous-série « Gestion cabinet » (US-2606). Strictement membership-driven
 * (`canManage = true`) : orthogonal au rôle clinique, **sans bypass ADMIN**
 * (l'ADMIN plateforme gère via `/admin/cabinets`, pas via le bloc gestion).
 * Trié par nom pour un picker stable.
 */
export async function getManagementScopes(userId: number): Promise<ManagementScope[]> {
  const rows = await prisma.healthcareMembership.findMany({
    where: { userId, canManage: true },
    select: { serviceId: true, isPrincipalAdmin: true, service: { select: { name: true } } },
    orderBy: { service: { name: "asc" } },
  })
  return rows.map((r) => ({
    serviceId: r.serviceId,
    serviceName: r.service.name,
    isPrincipalAdmin: r.isPrincipalAdmin,
  }))
}

/**
 * Le user a-t-il la capacité de gestion (Q2) sur **au moins un** service ?
 * Gate d'affichage du bloc « Gestion » de la sidebar (US-2606) — résolu serveur,
 * jamais côté client (le bloc est absent du DOM, pas masqué en CSS).
 */
export async function hasManagementCapability(userId: number): Promise<boolean> {
  const m = await prisma.healthcareMembership.findFirst({
    where: { userId, canManage: true },
    select: { id: true },
  })
  return m !== null
}

export type VerificationMode = "required" | "provisional"
export type ResolvedVerification = {
  mode: VerificationMode
  /** D'où vient la décision : politique tenant, politique pays, ou défaut fail-secure. */
  source: "tenant" | "country" | "default"
}

/** `provisional` honoré seulement si un flag pilote explicite est posé (prod).
 *  Lu via `getEnvBoolean` (source unique env.ts) plutôt qu'un compare brut. */
function pilotAllowed(): boolean {
  return getEnvBoolean("VERIFICATION_ALLOW_PILOT") === true
}

/**
 * Résout le mode de vérification « qualité PS » (porte Q1), ordre
 * `tenant > pays > défaut`, **fail-secure** :
 *  - aucune politique trouvée → `required` ;
 *  - `provisional` sans `expiresAt` futur → dégradé en `required` (borne obligatoire) ;
 *  - en **production**, `provisional` dégradé en `required` sauf `VERIFICATION_ALLOW_PILOT`.
 *
 * @returns le mode effectif + sa source (pour audit / affichage).
 */
export async function resolveVerificationPolicy(
  input: { tenantId?: number | null; country?: string | null },
  now: Date = new Date(),
): Promise<ResolvedVerification> {
  const isProd = process.env.NODE_ENV === "production"

  const honor = (mode: VerificationMode, expiresAt: Date | null, source: "tenant" | "country"): ResolvedVerification => {
    if (mode === "required") return { mode: "required", source }
    // provisional : borne obligatoire + interdit en prod sans flag pilote (fail-secure).
    if (!expiresAt || expiresAt <= now) return { mode: "required", source }
    if (isProd && !pilotAllowed()) return { mode: "required", source }
    return { mode: "provisional", source }
  }

  // 1) Politique du tenant (prioritaire).
  if (input.tenantId != null) {
    const p = await prisma.verificationPolicy.findFirst({
      where: { tenantId: input.tenantId },
      orderBy: { setAt: "desc" },
      select: { mode: true, expiresAt: true },
    })
    if (p) return honor(p.mode, p.expiresAt, "tenant")
  }

  // 2) Politique pays (fallback).
  if (input.country) {
    const p = await prisma.verificationPolicy.findFirst({
      where: { tenantId: null, country: input.country },
      orderBy: { setAt: "desc" },
      select: { mode: true, expiresAt: true },
    })
    if (p) return honor(p.mode, p.expiresAt, "country")
  }

  // 3) Défaut codé en dur — fail-secure.
  return { mode: "required", source: "default" }
}
