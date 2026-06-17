/**
 * US-2619/F7 — Bump de `User.authVersion`.
 *
 * À appeler **dans la même transaction** que tout changement de droits/statut
 * (rôle, suspension, capacités Q1/Q2 à venir). Incrémente la version recopiée
 * dans le claim JWT `av` → les tokens émis avant sont rejetés au refresh. À
 * coupler avec la révocation des sessions (`invalidateAllUserSessions`) pour un
 * effet **immédiat** (le refresh seul attendrait jusqu'à 15 min).
 */

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/client"

/** Incrémente `authVersion` du user. Accepte un client de transaction optionnel. */
export async function bumpAuthVersion(
  userId: number,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const db = tx ?? prisma
  await db.user.update({
    where: { id: userId },
    data: { authVersion: { increment: 1 } },
  })
}
