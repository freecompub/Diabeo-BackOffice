/**
 * @script backfill-encrypt-event-comments
 * @description NEW-M1 (review re-2 PR #407) — Chiffre les `comment`
 * stockés en clair sur `diabetes_events` (legacy avant le déploiement
 * de l'encryption AES-256-GCM sur eventsService / activityService).
 *
 * **Pré-condition** : la table contient potentiellement des rows avec
 * `comment` en clair (insertés via une route /api/events antérieure à
 * la migration encryption). À la lecture moderne, `safeDecryptField`
 * retourne `null` silencieusement → data loss côté API.
 *
 * **Stratégie** : pour chaque row avec `comment IS NOT NULL`, on tente
 * un `decrypt()` :
 *   - Succès → already encrypted, skip.
 *   - Échec → likely plaintext, on chiffre + on UPDATE.
 *
 * **Idempotent** : exécutable plusieurs fois sans dégradation. Logs
 * chaque action (scanned, encrypted, alreadyEncrypted, errors).
 *
 * **Usage** :
 *   pnpm tsx scripts/backfill-encrypt-event-comments.ts            (dry-run)
 *   pnpm tsx scripts/backfill-encrypt-event-comments.ts --apply    (write)
 *
 * **Audit** : émet un AuditLog `BACKFILL_ENCRYPT_COMMENT` par row
 * modifié (resource=ACTIVITY, action=UPDATE, metadata.kind=
 * "activity.backfill.encrypt", systemUser userId=null).
 */

import { PrismaClient } from "@prisma/client"
import { encrypt, decrypt } from "../src/lib/crypto/health-data"

const prisma = new PrismaClient()

interface Stats {
  scanned: number
  alreadyEncrypted: number
  encrypted: number
  errors: number
}

function isLikelyEncrypted(value: string): boolean {
  // Format chiffré : base64( IV(12) + TAG(16) + ciphertext ) = min 28 bytes
  // → min 38 chars base64. Heuristique conservative — un texte clair court
  // de 50 chars peut être un faux positif. On tente un decrypt réel.
  if (value.length < 38) return false
  if (!/^[A-Za-z0-9+/=]+$/.test(value)) return false
  try {
    decrypt(new Uint8Array(Buffer.from(value, "base64")))
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply")
  console.log(`[backfill-encrypt-event-comments] mode=${apply ? "APPLY" : "DRY-RUN"}`)

  const stats: Stats = { scanned: 0, alreadyEncrypted: 0, encrypted: 0, errors: 0 }
  const BATCH_SIZE = 500
  let cursor: string | undefined

  for (;;) {
    const rows = await prisma.diabetesEvent.findMany({
      where: { comment: { not: null } },
      select: { id: true, comment: true, patientId: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    })
    if (rows.length === 0) break
    cursor = rows[rows.length - 1]!.id

    for (const row of rows) {
      stats.scanned++
      if (!row.comment) continue
      if (isLikelyEncrypted(row.comment)) {
        stats.alreadyEncrypted++
        continue
      }
      const encrypted = Buffer.from(encrypt(row.comment)).toString("base64")
      if (apply) {
        try {
          await prisma.$transaction(async (tx) => {
            await tx.diabetesEvent.update({
              where: { id: row.id },
              data: { comment: encrypted },
            })
            await tx.auditLog.create({
              data: {
                userId: null,
                action: "UPDATE",
                resource: "ACTIVITY",
                resourceId: row.id,
                metadata: {
                  patientId: row.patientId,
                  kind: "activity.backfill.encrypt",
                  source: "system_backfill_script",
                },
              },
            })
          })
          stats.encrypted++
        } catch (e) {
          stats.errors++
          console.error(`  [error] id=${row.id}:`, e instanceof Error ? e.message : e)
        }
      } else {
        stats.encrypted++
        console.log(`  [DRY] would encrypt id=${row.id} patient=${row.patientId}`)
      }
    }

    console.log(`[progress] scanned=${stats.scanned} encrypted=${stats.encrypted} alreadyEncrypted=${stats.alreadyEncrypted} errors=${stats.errors}`)
  }

  console.log(`[done] ${JSON.stringify(stats)}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error("[fatal]", e)
  process.exit(1)
})
