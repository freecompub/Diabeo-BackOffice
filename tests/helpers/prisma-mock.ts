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
