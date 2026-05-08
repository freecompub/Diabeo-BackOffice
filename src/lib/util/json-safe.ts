/**
 * @module lib/util/json-safe
 * @description Helpers de sérialisation JSON-safe (BigInt, error sanitization).
 *
 * **Pourquoi** : extracted from backup.service.ts (PR #350 review M3 code) —
 * BigInt et sanitization sont des préoccupations cross-cutting (autres
 * services qui persistent des tailles de fichiers, des erreurs Prisma, etc.
 * vont en avoir besoin).
 */

/**
 * Convert a Prisma `BigInt | null` to a JSON-safe representation.
 * Returns `number` if it fits within `Number.MAX_SAFE_INTEGER` (2^53-1),
 * otherwise `string` to avoid silent precision loss on petabyte-scale dumps.
 */
export function bigIntToJson(value: bigint | null): number | string | null {
  if (value === null) return null
  return value <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(value)
    : value.toString()
}

/**
 * Strip Prisma-style error messages of values that may carry PHI.
 * Catches:
 *  - Double-quoted values (`Unique constraint failed on (email = "x@y.fr")`)
 *  - Single-quoted values (`Got invalid value 'x@y.fr'`)
 *  - Backtick-quoted values (`column \`email\` = ...`)
 *
 * Caps at the provided `maxLength` (default 500 — matches BackupLog
 * errorMessage column). Avoid emitting the full untrusted message verbatim
 * to audit columns (RGPD Art. 5(1)(c) minimisation).
 */
export function sanitizeErrorMessage(
  message: string,
  maxLength = 500,
): string {
  const stripped = message
    .replace(/"[^"]*"/g, "?")
    .replace(/'[^']*'/g, "?")
    .replace(/`[^`]*`/g, "?")
  return stripped.slice(0, maxLength)
}
