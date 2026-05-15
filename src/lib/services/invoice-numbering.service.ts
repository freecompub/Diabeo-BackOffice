/**
 * @module invoice-numbering.service
 * @description US-2105 — Numérotation séquentielle per-(country, year).
 *
 * Génère le prochain numéro de facture au format
 * `<countryCode>-<year>-<6digits>` (ex. `FR-2026-000001`) de manière
 * **gap-less** : aucune absence de numéro dans la séquence, exigence
 * comptable DGFiP (art. 242 nonies A CGI) et anti-fraude.
 *
 * Implémentation :
 *   1. INSERT … ON CONFLICT DO NOTHING (crée la ligne si manquante).
 *   2. SELECT … FOR UPDATE (verrou exclusif sur la ligne — sérialise
 *      les issuances concurrentes pour le même pays/année).
 *   3. UPDATE last_number = last_number + 1.
 *   4. Retourne le numéro formaté.
 *
 * Si la transaction parente rollback (ex. INSERT invoice échoue),
 * l'UPDATE last_number rollback aussi → pas de gap, pas de doublon.
 *
 * À appeler **uniquement** depuis une transaction Prisma (`tx`) car le
 * lock `FOR UPDATE` doit survivre jusqu'au commit de la facture.
 */

import type { Prisma } from "@prisma/client"

const MAX_NUMBER_PER_YEAR = 999_999 // 6 digits, ~zero risk de saturer

/**
 * Formate un numéro de facture au format réglementaire.
 *
 * @example
 *   formatInvoiceNumber("FR", 2026, 1) === "FR-2026-000001"
 *   formatInvoiceNumber("DZ", 2026, 42) === "DZ-2026-000042"
 */
export function formatInvoiceNumber(
  countryCode: string,
  year: number,
  sequence: number,
): string {
  if (countryCode.length !== 2) {
    throw new Error(`invalid countryCode: ${countryCode} (expected ISO 3166-1 alpha-2)`)
  }
  if (sequence <= 0 || sequence > MAX_NUMBER_PER_YEAR) {
    throw new Error(`invoice sequence out of range: ${sequence}`)
  }
  return `${countryCode.toUpperCase()}-${year}-${String(sequence).padStart(6, "0")}`
}

/**
 * Réserve et retourne le prochain numéro de facture pour
 * (countryCode, year) dans la transaction `tx`.
 *
 * **MUST be called inside a Prisma `$transaction`** — l'absence de
 * transaction lèverait le row lock dès l'UPDATE et briserait la
 * garantie gap-less sous concurrence.
 */
export async function reserveNextInvoiceNumber(
  tx: Prisma.TransactionClient,
  countryCode: string,
  year: number,
): Promise<string> {
  const cc = countryCode.toUpperCase()

  // (1) Crée la ligne si elle n'existe pas. ON CONFLICT évite l'erreur
  //     d'unicité quand deux issuances concurrentes la première année.
  await tx.$executeRaw`
    INSERT INTO invoice_sequences (country_code, year, last_number, updated_at)
    VALUES (${cc}, ${year}, 0, NOW())
    ON CONFLICT (country_code, year) DO NOTHING
  `

  // (2) Lock + read.
  const locked = await tx.$queryRaw<{ last_number: number }[]>`
    SELECT last_number FROM invoice_sequences
    WHERE country_code = ${cc} AND year = ${year}
    FOR UPDATE
  `
  if (locked.length === 0) {
    // ne devrait pas arriver : l'INSERT … ON CONFLICT garantit l'existence.
    throw new Error(`invoice_sequences row missing for (${cc}, ${year})`)
  }

  const next = locked[0]!.last_number + 1
  if (next > MAX_NUMBER_PER_YEAR) {
    throw new Error(
      `invoice sequence overflow for ${cc}-${year} (last=${locked[0]!.last_number})`,
    )
  }

  // (3) Avance le compteur. Le row lock garantit que personne d'autre
  //     ne lira la même valeur tant que la transaction n'est pas commitée.
  await tx.$executeRaw`
    UPDATE invoice_sequences
    SET last_number = ${next}, updated_at = NOW()
    WHERE country_code = ${cc} AND year = ${year}
  `

  return formatInvoiceNumber(cc, year, next)
}
