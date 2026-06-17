/**
 * @module verification-policy.service
 * @description US-2613 / F2 — Réglage de la **politique de vérification PS** (porte
 * Q1). Réservé `SYSTEM_ADMIN` (= `ADMIN` V1 ; garde de rôle portée par les routes).
 *
 * Écriture **fail-secure** (miroir de `capabilities.resolveVerificationPolicy`, qui
 * lit) :
 *  - cible = un tenant **OU** un pays (XOR) — jamais les deux, jamais aucun ;
 *  - `provisional` exige un `expiresAt` **futur** (garde-fou borné) ;
 *  - en **production**, `provisional` est refusé sauf flag pilote
 *    `VERIFICATION_ALLOW_PILOT` (DPIA) — on n'écrit pas une politique qui serait
 *    silencieusement dégradée à la lecture.
 *
 * Chaque écriture est auditée (`VERIFICATION_POLICY_CHANGED` /
 * `VERIFICATION_PROVISIONAL_SET`). Append-only : on empile les politiques, la
 * résolution prend la plus récente (`setAt desc`).
 */

import type { VerificationMode } from "@prisma/client"
import { prisma } from "@/lib/db/client"
import { getEnvBoolean } from "@/lib/env"
import { auditService } from "./audit.service"
import type { AuditContext } from "./audit.service"

/** Erreur typée → mappée en statut HTTP par les routes. */
export class VerificationPolicyError extends Error {
  constructor(
    public code:
      | "targetRequired" // ni tenant ni pays
      | "targetAmbiguous" // tenant ET pays
      | "tenantNotFound"
      | "expiresAtRequired" // provisional sans borne future
      | "provisionalForbiddenInProd", // prod sans flag pilote
  ) {
    super(code)
    this.name = "VerificationPolicyError"
  }
}

export function verificationPolicyErrorStatus(code: VerificationPolicyError["code"]): number {
  if (code === "tenantNotFound") return 404
  return 409 // invariants d'écriture
}

export type SetPolicyInput = {
  tenantId?: number | null
  country?: string | null
  mode: VerificationMode
  /** Obligatoire si `mode = provisional`. */
  expiresAt?: Date | null
}

export type PolicyView = {
  id: number
  tenantId: number | null
  country: string | null
  mode: VerificationMode
  expiresAt: Date | null
  setById: number
  setAt: Date
}

function normalizeCountry(country?: string | null): string | null {
  const c = country?.trim().toUpperCase()
  return c ? c : null
}

/** `provisional` honoré seulement si flag pilote explicite (prod). */
function pilotAllowed(): boolean {
  return getEnvBoolean("VERIFICATION_ALLOW_PILOT") === true
}

export const verificationPolicyService = {
  /** Liste les politiques (optionnellement filtrées par tenant ou pays). */
  async list(
    filter: { tenantId?: number; country?: string },
    auditUserId: number,
    ctx?: AuditContext,
  ): Promise<PolicyView[]> {
    const rows = await prisma.verificationPolicy.findMany({
      where: {
        ...(filter.tenantId != null && { tenantId: filter.tenantId }),
        ...(filter.country && { country: normalizeCountry(filter.country) }),
      },
      orderBy: { setAt: "desc" },
      select: {
        id: true, tenantId: true, country: true, mode: true,
        expiresAt: true, setById: true, setAt: true,
      },
    })

    await auditService.log({
      userId: auditUserId, action: "READ", resource: "VERIFICATION_POLICY",
      resourceId: "admin:verification-policies:list",
      ...(filter.tenantId != null && { tenantId: filter.tenantId }),
      ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
      metadata: { count: rows.length },
    })

    return rows
  },

  /**
   * Pose une nouvelle politique (append-only). Applique les invariants fail-secure
   * AVANT écriture : on refuse une politique qui serait de toute façon dégradée à
   * la lecture, plutôt que de la stocker en silence.
   */
  async setPolicy(
    input: SetPolicyInput,
    auditUserId: number,
    ctx?: AuditContext,
    now: Date = new Date(),
  ): Promise<{ id: number }> {
    const country = normalizeCountry(input.country)
    const hasTenant = input.tenantId != null
    const hasCountry = country != null

    // Cible = tenant XOR pays.
    if (!hasTenant && !hasCountry) throw new VerificationPolicyError("targetRequired")
    if (hasTenant && hasCountry) throw new VerificationPolicyError("targetAmbiguous")

    if (hasTenant) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: input.tenantId! }, select: { id: true },
      })
      if (!tenant) throw new VerificationPolicyError("tenantNotFound")
    }

    // Invariants `provisional` (fail-secure, miroir de la résolution).
    if (input.mode === "provisional") {
      if (!input.expiresAt || input.expiresAt <= now) {
        throw new VerificationPolicyError("expiresAtRequired")
      }
      if (process.env.NODE_ENV === "production" && !pilotAllowed()) {
        throw new VerificationPolicyError("provisionalForbiddenInProd")
      }
    }

    const expiresAt = input.mode === "provisional" ? input.expiresAt! : null

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.verificationPolicy.create({
        data: {
          tenantId: hasTenant ? input.tenantId! : null,
          country: hasTenant ? null : country,
          mode: input.mode,
          expiresAt,
          setById: auditUserId,
        },
        select: { id: true },
      })
      await auditService.logWithTx(tx, {
        userId: auditUserId,
        action: input.mode === "provisional" ? "VERIFICATION_PROVISIONAL_SET" : "VERIFICATION_POLICY_CHANGED",
        resource: "VERIFICATION_POLICY",
        resourceId: String(row.id),
        ...(hasTenant && { tenantId: input.tenantId! }),
        ipAddress: ctx?.ipAddress, userAgent: ctx?.userAgent, requestId: ctx?.requestId,
        newValue: {
          tenantId: hasTenant ? input.tenantId! : null,
          country: hasTenant ? null : country,
          mode: input.mode,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
      })
      return row
    })

    return created
  },
}
