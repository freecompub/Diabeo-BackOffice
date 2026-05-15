/**
 * Prisma client mock for unit tests.
 *
 * Uses vitest-mock-extended to create a deep mock of PrismaClient.
 * Every method returns undefined by default — tests must configure
 * return values explicitly with mockResolvedValue / mockReturnValue.
 *
 * Usage in tests:
 *   import { prismaMock } from "../helpers/prisma-mock"
 *   prismaMock.patient.findFirst.mockResolvedValue({ ... })
 *
 * The mock is auto-reset between tests via vi.mock() + beforeEach.
 */

import { vi, beforeEach } from "vitest"
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended"
import type { PrismaClient } from "@prisma/client"

// Create a deep mock of PrismaClient
export const prismaMock: DeepMockProxy<PrismaClient> = mockDeep<PrismaClient>()

// Mock the db/client module so all imports of `prisma` get the mock
vi.mock("@/lib/db/client", () => ({
  prisma: prismaMock,
}))

// Reset all mock state between tests for isolation
beforeEach(() => {
  mockReset(prismaMock)
})

/**
 * L-RR3-5 (review re-3 PR #406) — Helper de mock partagé pour le
 * runtime guard de `reserveNextInvoiceNumber` (H-NEW-4). Tout test
 * qui exerce indirectement `invoiceService.issue` doit appeler ceci
 * dans son `beforeEach` pour que la SQL `pg_current_xact_id_if_assigned`
 * retourne un fake xid (simule une transaction Postgres active).
 *
 * Le 2ᵉ argument permet de configurer ce que retournent les autres
 * `$queryRaw` (typiquement `SELECT last_number ...`).
 *
 * @example
 *   beforeEach(() => {
 *     mockInvoiceTxGuard({ lastNumber: 0 })
 *   })
 */
export function mockInvoiceTxGuard(opts: { lastNumber?: number } = {}): void {
  const lastNumber = opts.lastNumber ?? 0
  prismaMock.$executeRaw.mockResolvedValue(1 as any)
  prismaMock.$queryRaw.mockImplementation((sql: any) => {
    const text = Array.isArray(sql) ? sql.join("") : String(sql)
    if (text.includes("pg_current_xact_id_if_assigned")) {
      return Promise.resolve([{ xid: "fake-xid" }]) as any
    }
    if (text.includes("last_number")) {
      return Promise.resolve([{ last_number: lastNumber }]) as any
    }
    return Promise.resolve([]) as any
  })
}
