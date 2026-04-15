/**
 * decrypt-smoke.ts — post-restore encryption smoke test
 *
 * Runs after a PostgreSQL restore drill (see docs/operations/runbook.md
 * §Backups — "Restore drill"). Validates that the current
 * HEALTH_DATA_ENCRYPTION_KEY can decrypt the PII fields on a sample of
 * User rows in the target database.
 *
 * Catches:
 * - Key-rotation incidents: the backup was encrypted with a prior key but
 *   the current key is different → decrypt fails, restore is non-usable.
 * - Base64 corruption: the DB dump round-tripped a field incorrectly.
 * - Schema drift: a field the script expects to be encrypted is plaintext
 *   (or vice-versa).
 *
 * Usage:
 *   DATABASE_URL=postgres://... \
 *   HEALTH_DATA_ENCRYPTION_KEY=<hex32> \
 *   HMAC_SECRET=<any> \
 *   pnpm tsx scripts/decrypt-smoke.ts
 *
 * The HMAC_SECRET is only required because the crypto module imports it
 * at module-load; any non-empty string works for the decrypt check.
 *
 * Exit codes:
 *   0 — all sampled rows decrypted cleanly
 *   1 — missing env var or DB connection error
 *   2 — at least one decryption failure (forensic detail printed)
 */

import { PrismaClient } from "@prisma/client"
import { safeDecryptField } from "@/lib/crypto/fields"

const SAMPLE_SIZE = 5
const FIELDS_TO_CHECK = ["firstname", "lastname", "phone", "address1", "city"] as const
type EncryptedField = typeof FIELDS_TO_CHECK[number]

function log(msg: string): void {
  console.log(`[decrypt-smoke] ${msg}`)
}

function fail(msg: string): never {
  console.error(`[decrypt-smoke][ERROR] ${msg}`)
  process.exit(2)
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("[decrypt-smoke][ERROR] DATABASE_URL is not set")
    process.exit(1)
  }
  if (!process.env.HEALTH_DATA_ENCRYPTION_KEY) {
    console.error("[decrypt-smoke][ERROR] HEALTH_DATA_ENCRYPTION_KEY is not set")
    process.exit(1)
  }

  const prisma = new PrismaClient()

  try {
    log(`Sampling ${SAMPLE_SIZE} non-anonymized users…`)
    const users = await prisma.user.findMany({
      where: { passwordHash: { not: "DELETED" } },
      take: SAMPLE_SIZE,
      select: {
        id: true,
        firstname: true,
        lastname: true,
        phone: true,
        address1: true,
        city: true,
      },
    })

    if (users.length === 0) {
      log("No non-anonymized users in the DB — nothing to check.")
      log("(This is expected on a freshly seeded DB without fixtures.)")
      return
    }

    log(`Checking ${users.length} rows × ${FIELDS_TO_CHECK.length} fields…`)

    const failures: Array<{ userId: number; field: EncryptedField; error: string }> = []

    for (const user of users) {
      for (const field of FIELDS_TO_CHECK) {
        const ciphertext = user[field]
        if (ciphertext == null) continue // Field legitimately empty
        try {
          const plaintext = safeDecryptField(ciphertext)
          if (plaintext == null) {
            failures.push({ userId: user.id, field, error: "safeDecryptField returned null" })
          }
        } catch (err) {
          failures.push({
            userId: user.id,
            field,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }

    if (failures.length > 0) {
      console.error(`[decrypt-smoke][FAILED] ${failures.length} decrypt errors`)
      for (const f of failures) {
        console.error(`  user=${f.userId} field=${f.field} error=${f.error}`)
      }
      fail("Encryption key does NOT match the data. Aborting drill — investigate.")
    }

    log(`✓ All ${users.length * FIELDS_TO_CHECK.length} (user × field) samples decrypted cleanly.`)
  } catch (err) {
    console.error("[decrypt-smoke][ERROR] Unexpected error:", err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

void main()
