/**
 * @module cabinet-access
 * @description Garde commune des **pages** « Gestion cabinet » per-id (US-2606 /
 * US-2610) — Server Components uniquement.
 *
 * Valide l'`id` de route (regex stricte, id canonique pour l'audit), l'auth
 * (headers JWT middleware) et la **capacité de gestion Q2** sur CE service
 * (`ADMIN` bypass). Renvoie un **404 uniforme** si non autorisé → anti-énumération
 * du périmètre cabinet (un Q2 d'un autre cabinet ne distingue pas « existe pas »
 * de « pas mon scope »). L'enforcement réel reste porté par les routes API.
 */

import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import type { Role } from "@prisma/client"
import { canManageOrg } from "@/lib/capabilities"

export type CabinetManagementAccess = {
  cabinetId: number
  userId: number
  role: Role
}

/**
 * Garde d'une page de gestion scopée à un cabinet (`/cabinet/[id]/…`).
 *
 * @param idParam segment `[id]` brut de la route.
 * @returns identité + cabinetId validés si l'accès Q2 est accordé.
 * @throws redirige `/login` si non authentifié ; `notFound()` si id invalide
 *         ou capacité Q2 absente sur ce service.
 */
export async function requireCabinetManagementAccess(
  idParam: string,
): Promise<CabinetManagementAccess> {
  // Regex stricte (vs parseInt qui tronque "1.5xyz") — id canonique pour l'audit.
  if (!/^[1-9]\d{0,9}$/.test(idParam)) notFound()
  const cabinetId = Number.parseInt(idParam, 10)

  const h = await headers()
  const userId = Number(h.get("x-user-id"))
  const role = h.get("x-user-role") as Role | null
  if (!userId || !Number.isInteger(userId) || !role) redirect("/login")

  // Garde Q2 : ADMIN passe ; sinon il faut la capacité de gestion sur CE service.
  // NB : pour un ADMIN, on ne vérifie PAS l'existence du cabinet ici — un id de
  // format valide mais inexistant est confirmé en aval (le service/API renvoie
  // notFound/erreur). Pour un non-ADMIN, `canManageOrg` false couvre à la fois
  // « cabinet inexistant » et « hors de mon périmètre » → 404 uniforme.
  if (role !== "ADMIN" && !(await canManageOrg(userId, cabinetId))) {
    notFound() // 404 uniforme (anti-énumération du périmètre cabinet)
  }

  return { cabinetId, userId, role }
}
