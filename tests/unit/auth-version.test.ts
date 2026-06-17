/**
 * Test suite : bumpAuthVersion (US-2619/F7).
 * Incrémente `User.authVersion` (claim JWT `av`) ; accepte un client de tx.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import { bumpAuthVersion } from "@/lib/auth/auth-version"

beforeEach(() => vi.clearAllMocks())

describe("bumpAuthVersion", () => {
  it("incrémente authVersion du user (client par défaut)", async () => {
    prismaMock.user.update.mockResolvedValue({} as never)
    await bumpAuthVersion(42)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { authVersion: { increment: 1 } },
    })
  })

  it("utilise le client de transaction fourni", async () => {
    const tx = { user: { update: vi.fn().mockResolvedValue({}) } }
    await bumpAuthVersion(7, tx as never)
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { authVersion: { increment: 1 } },
    })
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })
})
