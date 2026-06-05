/**
 * Régression A5 — la route legacy `/users` redirige vers `/admin/users`.
 *
 * `/users` hébergeait un stub « Bientôt disponible » (doublon de la vraie UI
 * `/admin/users`). La nav pointe désormais directement sur `/admin/users` ;
 * `/users` ne sert plus que d'alias de redirection (anciens liens / favoris).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const redirect = vi.fn()
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirect(...args),
}))

import UsersLegacyRedirect from "@/app/(dashboard)/users/page"

describe("/users (legacy) — redirection A5", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("redirige vers /admin/users", () => {
    UsersLegacyRedirect()
    expect(redirect).toHaveBeenCalledTimes(1)
    expect(redirect).toHaveBeenCalledWith("/admin/users")
  })
})
