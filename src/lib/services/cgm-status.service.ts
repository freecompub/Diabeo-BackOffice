/**
 * US-2631 (socle fiche patient) — source de données glycémique d'un patient.
 *
 * `patientHasCgm` distingue **CGM (capteur)** de **BGM (glycémie capillaire)** :
 * la fiche patient bascule de présentation en conséquence (fail-closed — jamais
 * de métrique CGM-only, ex. TIR-temps/GMI/AGP, pour un patient sans capteur, qui
 * serait trompeuse).
 *
 * Vrai si : capteur CGM **actif** (catégorie cgm, non révoqué, sensor non
 * expiré) **OU** relevés CGM récents (< 14 j). Helper booléen pur — aucune
 * donnée de santé restituée, **non audité** (l'appelant audite le flux
 * composite, cf. `analyticsService`/routes).
 */

import { DeviceCategory } from "@prisma/client"
import { prisma } from "@/lib/db/client"

/** Fenêtre de « données CGM récentes » servant de fallback à la détection capteur. */
const RECENT_CGM_DAYS = 14

export const cgmStatusService = {
  async patientHasCgm(patientId: number): Promise<boolean> {
    const now = new Date()
    // Capteur CGM « actif » = expiration future. Un device CGM dont
    // `sensorExpiresAt` est NULL (inconnu) n'est volontairement PAS considéré
    // actif ici (sémantique Prisma `gt` exclut NULL) : il retombe sur le
    // fallback « CGM récent < 14 j », qui reflète l'usage réel. Fail-closed.
    const activeSensor = await prisma.patientDevice.findFirst({
      where: {
        patientId,
        category: DeviceCategory.cgm,
        revokedAt: null,
        sensorExpiresAt: { gt: now },
      },
      select: { patientId: true },
    })
    if (activeSensor) return true

    const since = new Date(now.getTime() - RECENT_CGM_DAYS * 24 * 3600_000)
    const recent = await prisma.cgmEntry.findFirst({
      where: { patientId, timestamp: { gte: since } },
      select: { patientId: true },
    })
    return recent !== null
  },
}
