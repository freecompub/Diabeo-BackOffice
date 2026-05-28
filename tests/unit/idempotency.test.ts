/**
 * Tests pour `src/lib/idempotency/service.ts` (Plan B follow-up A1).
 *
 * Couvre : isValidIdempotencyKey, hashBody, lookup miss/replay/mismatch, store + TTL,
 * scope par-user (anti cross-user replay).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  idempotencyService,
  isValidIdempotencyKey,
  hashBody,
} from "@/lib/idempotency/service"

describe("isValidIdempotencyKey", () => {
  it("accepte UUID v4 valides", () => {
    expect(isValidIdempotencyKey("a3f9b8c2-4d56-4e89-8f12-345678abcdef")).toBe(true)
    expect(isValidIdempotencyKey("00000000-0000-4000-8000-000000000000")).toBe(true)
  })

  it("refuse UUID non-v4 (version bit != 4)", () => {
    expect(isValidIdempotencyKey("a3f9b8c2-4d56-1e89-8f12-345678abcdef")).toBe(false) // v1
    expect(isValidIdempotencyKey("a3f9b8c2-4d56-5e89-8f12-345678abcdef")).toBe(false) // v5
  })

  it("refuse variant bit incorrect (doit être 8/9/a/b)", () => {
    expect(isValidIdempotencyKey("a3f9b8c2-4d56-4e89-0f12-345678abcdef")).toBe(false)
    expect(isValidIdempotencyKey("a3f9b8c2-4d56-4e89-cf12-345678abcdef")).toBe(false)
  })

  it("refuse strings vides / null / mal formées", () => {
    expect(isValidIdempotencyKey(null)).toBe(false)
    expect(isValidIdempotencyKey("")).toBe(false)
    expect(isValidIdempotencyKey("not-a-uuid")).toBe(false)
    expect(isValidIdempotencyKey("a3f9b8c2-4d56-4e89-8f12")).toBe(false) // tronqué
  })
})

describe("hashBody", () => {
  it("hashes deterministically SHA-256", () => {
    const a = hashBody(`{"role":"DOCTOR"}`)
    const b = hashBody(`{"role":"DOCTOR"}`)
    expect(a).toBe(b)
    expect(a).toHaveLength(64) // hex sha256
  })

  it("different bodies → different hashes", () => {
    const a = hashBody(`{"role":"DOCTOR"}`)
    const b = hashBody(`{"role":"ADMIN"}`)
    expect(a).not.toBe(b)
  })

  it("whitespace-sensitive (bytewise stability)", () => {
    const a = hashBody(`{"role":"DOCTOR"}`)
    const b = hashBody(`{ "role" : "DOCTOR" }`)
    expect(a).not.toBe(b)
  })
})

describe("idempotencyService.lookup + store (in-memory fallback)", () => {
  beforeEach(() => {
    idempotencyService.__resetMemoryForTests()
  })
  afterEach(() => {
    idempotencyService.__resetMemoryForTests()
  })

  const key = "a3f9b8c2-4d56-4e89-8f12-345678abcdef"
  const userId = 42
  const bodyHash = hashBody(`{"role":"DOCTOR"}`)

  it("miss : pas d'entrée → type miss", async () => {
    const result = await idempotencyService.lookup(key, userId, bodyHash)
    expect(result.type).toBe("miss")
  })

  it("store + lookup même body → replay", async () => {
    await idempotencyService.store(
      { key, bodyHash, status: 200, body: `{"ok":true}`, contentType: "application/json" },
      userId,
    )
    const result = await idempotencyService.lookup(key, userId, bodyHash)
    expect(result.type).toBe("replay")
    if (result.type === "replay") {
      expect(result.status).toBe(200)
      expect(result.body).toBe(`{"ok":true}`)
      expect(result.contentType).toBe("application/json")
    }
  })

  it("store + lookup body différent → mismatch", async () => {
    await idempotencyService.store(
      { key, bodyHash, status: 200, body: `{"ok":true}`, contentType: "application/json" },
      userId,
    )
    const otherBodyHash = hashBody(`{"role":"ADMIN"}`)
    const result = await idempotencyService.lookup(key, userId, otherBodyHash)
    expect(result.type).toBe("mismatch")
  })

  it("scope par user — replay user A ne match pas user B (cross-user safety)", async () => {
    await idempotencyService.store(
      { key, bodyHash, status: 200, body: `{"ok":true}`, contentType: "application/json" },
      userId,
    )
    // Autre user, même key + body → miss (clé scope par user).
    const result = await idempotencyService.lookup(key, 99, bodyHash)
    expect(result.type).toBe("miss")
  })
})
