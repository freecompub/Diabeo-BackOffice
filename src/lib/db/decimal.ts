/**
 * @module db/decimal
 * @description Typed coercion of Prisma Decimal columns to JS numbers.
 *
 * Prisma's `Decimal` type carries fixed-point precision that JS `number`
 * cannot represent past 53 bits of mantissa. For clinical metrics over CGM
 * data (glucose 0.40–5.00 g/L, fewer than 4 significant digits) the loss is
 * negligible, but the conversion must be done explicitly — otherwise
 * `Number(decimal)` works by accident and breaks the day Prisma switches
 * adapter or returns a plain number for some legacy column.
 *
 * Use this helper anywhere a service consumes a Decimal field. Single source
 * of truth so analytics + population services don't drift on the coercion
 * pattern.
 */

import { Prisma } from "@prisma/client"

/**
 * Coerce a value that may be a Prisma Decimal, a JS number, or null/undefined.
 * Falls back to `Number(value)` for non-Decimal values; uses `.toNumber()`
 * on actual `Prisma.Decimal` instances.
 *
 * The check is `instanceof Prisma.Decimal` (not duck-typing) so a foreign
 * object with a `toNumber` method is rejected and gets the `Number()` branch
 * (which will produce `NaN` for objects, surfacing the bug).
 */
export function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (value instanceof Prisma.Decimal) return value.toNumber()
  return Number(value)
}
