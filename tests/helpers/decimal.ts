/**
 * Shared test helper: wrap a plain number in Prisma.Decimal.
 * Mirrors the shape Prisma returns for PostgreSQL Decimal columns so that
 * `.toNumber()` and arithmetic behave identically in tests and production.
 */

import { Prisma } from "@prisma/client"

export const d = (n: number): Prisma.Decimal => new Prisma.Decimal(n)
