/**
 * Test suite : activity (US-2621 — session glissante d'inactivité, Redis).
 *
 * Risque sécurité : la fenêtre glissante gouverne l'accès backoffice. Une
 * erreur Redis doit **fail-closed** (timedOut → accès coupé), jamais fail-open ;
 * une fenêtre expirée (clé absente, SET XX → null) = inactivité = accès coupé.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const set = vi.fn()
const del = vi.fn()
let client: { set: typeof set; del: typeof del } | null = { set, del }

vi.mock("@/lib/auth/redis-client", () => ({
  getRedis: () => client,
  REDIS_APP_PREFIX: "test:",
}))

const get = vi.fn()

import {
  inactivityWindowSeconds, startActivity, slideActivity, peekActivity, clearActivity,
} from "@/lib/auth/activity"

beforeEach(() => {
  vi.clearAllMocks()
  client = { set, del, get } as never
})

describe("inactivityWindowSeconds", () => {
  it("VIEWER (patient) non soumis → null", () => {
    expect(inactivityWindowSeconds("VIEWER")).toBeNull()
  })
  it("ADMIN renforcé (15 min)", () => {
    expect(inactivityWindowSeconds("ADMIN")).toBe(15 * 60)
  })
  it("DOCTOR / NURSE backoffice (30 min)", () => {
    expect(inactivityWindowSeconds("DOCTOR")).toBe(30 * 60)
    expect(inactivityWindowSeconds("NURSE")).toBe(30 * 60)
  })
})

describe("startActivity", () => {
  it("crée la clé avec TTL = fenêtre", async () => {
    set.mockResolvedValue("OK")
    await startActivity("sid1", 1800)
    expect(set).toHaveBeenCalledWith("test:sess:sid1", "1", { ex: 1800 })
  })
  it("no-op si Redis non configuré", async () => {
    client = null
    await startActivity("sid1", 1800)
    expect(set).not.toHaveBeenCalled()
  })
})

describe("slideActivity", () => {
  it("rafraîchit la fenêtre (SET XX) → active si la clé existe", async () => {
    set.mockResolvedValue("OK")
    expect(await slideActivity("sid1", 1800)).toBe("active")
    expect(set).toHaveBeenCalledWith("test:sess:sid1", "1", { ex: 1800, xx: true })
  })
  it("clé absente (SET XX → null) → timedOut (inactivité)", async () => {
    set.mockResolvedValue(null)
    expect(await slideActivity("sid1", 1800)).toBe("timedOut")
  })
  it("erreur Redis → timedOut (fail-closed)", async () => {
    set.mockRejectedValue(new Error("redis down"))
    expect(await slideActivity("sid1", 1800)).toBe("timedOut")
  })
  it("Redis non configuré (dev/test) → active (check ignoré)", async () => {
    client = null
    expect(await slideActivity("sid1", 1800)).toBe("active")
  })
})

describe("peekActivity (sans slide)", () => {
  it("clé présente (GET non-null) → active, sans rafraîchir la fenêtre", async () => {
    get.mockResolvedValue("1")
    expect(await peekActivity("sid1")).toBe("active")
    expect(get).toHaveBeenCalledWith("test:sess:sid1")
    expect(set).not.toHaveBeenCalled() // peek ne prolonge PAS l'inactivité
  })
  it("clé absente (GET null) → timedOut", async () => {
    get.mockResolvedValue(null)
    expect(await peekActivity("sid1")).toBe("timedOut")
  })
  it("erreur Redis → timedOut (fail-closed)", async () => {
    get.mockRejectedValue(new Error("redis down"))
    expect(await peekActivity("sid1")).toBe("timedOut")
  })
})

describe("clearActivity", () => {
  it("supprime la clé d'activité", async () => {
    del.mockResolvedValue(1)
    await clearActivity("sid1")
    expect(del).toHaveBeenCalledWith("test:sess:sid1")
  })
})
