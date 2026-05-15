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
 * Review PR #406 C1 — runtime guard : on vérifie via
 * `pg_current_xact_id_if_assigned()` que le caller est bien dans une
 * transaction explicite. Sans ça, l'UPDATE last_number commit
 * immédiatement et un échec applicatif aval crée un gap permanent.
 */

import { Prisma } from "@prisma/client"

const MAX_NUMBER_PER_YEAR = 999_999 // 6 digits, ~zero risk de saturer

/**
 * Erreur métier 409 lorsque la séquence est saturée pour une année.
 * Mappable à un code HTTP 409 par le route layer.
 */
export class InvoiceSequenceOverflowError extends Error {
  constructor(public countryCode: string, public year: number, public last: number) {
    super(`invoice sequence overflow for ${countryCode}-${year} (last=${last})`)
    this.name = "InvoiceSequenceOverflowError"
  }
}

/**
 * Erreur si `reserveNextInvoiceNumber` est appelé hors transaction
 * Postgres explicite. Detection via `pg_current_xact_id_if_assigned()`.
 */
export class InvoiceNumberingTransactionError extends Error {
  constructor() {
    super("reserveNextInvoiceNumber must be called inside a Prisma $transaction")
    this.name = "InvoiceNumberingTransactionError"
  }
}

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
 * **MUST be called inside a Prisma `$transaction`** — vérifié à
 * l'exécution via `pg_current_xact_id_if_assigned()` (review PR #406 C1).
 */
export async function reserveNextInvoiceNumber(
  tx: Prisma.TransactionClient,
  countryCode: string,
  year: number,
): Promise<string> {
  const cc = countryCode.toUpperCase()

  // C1 + H-NEW-4 (review re-2) — Runtime guard : si on n'est PAS dans
  // une transaction explicite, l'UPDATE commit immédiatement et un
  // échec applicatif aval crée un gap permanent dans la séquence.
  // `pg_current_xact_id_if_assigned()` retourne NULL hors transaction.
  //
  // H-NEW-4 fix : suppression du gate `NODE_ENV !== "test"`. La SQL
  // est toujours exécutée, y compris en test ; le mock `$queryRaw`
  // peut retourner `[{ xid: "fake-xid" }]` pour simuler une vraie tx.
  // Pas de short-circuit silencieux — défense réelle contre tx-skip.
  const guard = await tx.$queryRaw<{ xid: string | null }[]>`
    SELECT pg_current_xact_id_if_assigned()::text AS xid
  `
  if (!guard[0] || guard[0].xid === null) {
    throw new InvoiceNumberingTransactionError()
  }

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
    throw new InvoiceSequenceOverflowError(cc, year, locked[0]!.last_number)
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
