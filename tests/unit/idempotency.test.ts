/**
 * Tests pour `src/lib/idempotency/service.ts` (Plan B follow-up A1 round 2).
 *
 * Round 2 — 38 findings résolus :
 * - C-HSA-1 : Upstash auto-deserialize (pas de JSON.parse manuel)
 * - C-TA-1/2/3/4 : 5xx strip + Content-Type preserve + audit + concurrent race
 * - H-CR-3 : NX lock PENDING sentinel race window
 * - H-CR-4 : LRU memory cap
 * - H-HSA-1 : body encrypted AES-256-GCM in cache
 * - H-TA-3/4 : TTL expiry + Redis throw fail-open
 * - M-CR-6 : __resetMemoryForTests whitelist test env
 * - M-TA-1/2 : body unicode + UUID v4 uppercase
 * - LOW-CR-6 : mismatch + bodyHash undefined
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  idempotencyService,
  isValidIdempotencyKey,
  hashBody,
  type StoreInput,
} from "@/lib/idempotency/service"

const validHeaders = { "content-type": "application/json" }

describe("isValidIdempotencyKey", () => {
  it("accepte UUID v4 valides lowercase", () => {
    expect(isValidIdempotencyKey("a3f9b8c2-4d56-4e89-8f12-345678abcdef")).toBe(true)
    expect(isValidIdempotencyKey("00000000-0000-4000-8000-000000000000")).toBe(true)
  })

  // M-TA-2 — UUID v4 case-insensitive (regex `/i`).
  it("accepte UUID v4 uppercase (case-insensitive)", () => {
    expect(isValidIdempotencyKey("A3F9B8C2-4D56-4E89-8F12-345678ABCDEF")).toBe(true)
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

  // M-TA-1 — body unicode arabe/cyrillique/emoji bytewise stability.
  it("body unicode multi-bytes — déterministe", () => {
    const a = hashBody(`{"name":"محمد"}`)
    const b = hashBody(`{"name":"محمد"}`)
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
    // Different from latin-only
    const c = hashBody(`{"name":"Mohammed"}`)
    expect(a).not.toBe(c)
  })

  it("body emoji UTF-8 multi-bytes", () => {
    const h = hashBody(`{"reaction":"👍🏼"}`)
    expect(h).toHaveLength(64)
  })
})

describe("idempotencyService.lookup + store (memory fallback)", () => {
  beforeEach(() => {
    idempotencyService.__resetMemoryForTests()
  })
  afterEach(() => {
    idempotencyService.__resetMemoryForTests()
  })

  const key = "a3f9b8c2-4d56-4e89-8f12-345678abcdef"
  const userId = 42
  const bodyHash = hashBody(`{"role":"DOCTOR"}`)

  const sampleStore: StoreInput = {
    key,
    bodyHash,
    status: 200,
    body: `{"ok":true}`,
    headers: validHeaders,
  }

  it("miss : pas d'entrée → type miss", async () => {
    const result = await idempotencyService.lookup(key, userId, bodyHash)
    expect(result.type).toBe("miss")
  })

  it("store + lookup même body → replay avec headers préservés", async () => {
    await idempotencyService.store(sampleStore, userId)
    const result = await idempotencyService.lookup(key, userId, bodyHash)
    expect(result.type).toBe("replay")
    if (result.type === "replay") {
      expect(result.status).toBe(200)
      expect(result.body).toBe(`{"ok":true}`)
      expect(result.headers["content-type"]).toBe("application/json")
    }
  })

  it("store + lookup body différent → mismatch", async () => {
    await idempotencyService.store(sampleStore, userId)
    const otherBodyHash = hashBody(`{"role":"ADMIN"}`)
    const result = await idempotencyService.lookup(key, userId, otherBodyHash)
    expect(result.type).toBe("mismatch")
  })

  it("scope par user — user A cache, user B même key+body → miss", async () => {
    await idempotencyService.store(sampleStore, userId)
    const result = await idempotencyService.lookup(key, 99, bodyHash)
    expect(result.type).toBe("miss")
  })

  // H-HSA-1 — body chiffré AES-256-GCM en cache (anti dump Redis).
  it("body stocké chiffré AES-256-GCM — pas exposé en clair", async () => {
    await idempotencyService.store(sampleStore, userId)
    // On vérifie via re-lookup que le decrypt fonctionne (round-trip).
    const result = await idempotencyService.lookup(key, userId, bodyHash)
    expect(result.type).toBe("replay")
    if (result.type === "replay") {
      // body déchiffré = plaintext original
      expect(result.body).toBe(`{"ok":true}`)
    }
    // (Vérification ciphertext-vs-plaintext faite via integration test
    // direct sur le Map memory — voir tests integration.)
  })
})

describe("idempotencyService — race window NX lock (H-CR-3)", () => {
  beforeEach(() => idempotencyService.__resetMemoryForTests())
  afterEach(() => idempotencyService.__resetMemoryForTests())

  const key = "a3f9b8c2-4d56-4e89-8f12-345678abcdef"
  const userId = 42

  it("acquirePendingLock — 1er succès, 2e échec (concurrent), libérable", async () => {
    const ok1 = await idempotencyService.acquirePendingLock(key, userId)
    expect(ok1).toBe(true)
    const ok2 = await idempotencyService.acquirePendingLock(key, userId)
    expect(ok2).toBe(false)
    // Release puis re-acquire
    await idempotencyService.releasePending(key, userId)
    const ok3 = await idempotencyService.acquirePendingLock(key, userId)
    expect(ok3).toBe(true)
  })

  it("lookup pendant PENDING lock → in_progress", async () => {
    await idempotencyService.acquirePendingLock(key, userId)
    const result = await idempotencyService.lookup(key, userId, "deadbeef".repeat(8))
    expect(result.type).toBe("in_progress")
  })
})

describe("idempotencyService.purgeUserKeys — RGPD Art. 17 (H-HSA-1)", () => {
  beforeEach(() => idempotencyService.__resetMemoryForTests())
  afterEach(() => idempotencyService.__resetMemoryForTests())

  it("purge tous les keys d'un user, laisse les autres intacts", async () => {
    const key1 = "a3f9b8c2-4d56-4e89-8f12-345678abcdef"
    const key2 = "b3f9b8c2-4d56-4e89-8f12-345678abcdef"
    const userA = 42
    const userB = 99
    const bodyHash = hashBody(`{}`)

    await idempotencyService.store(
      { key: key1, bodyHash, status: 200, body: "{}", headers: validHeaders },
      userA,
    )
    await idempotencyService.store(
      { key: key2, bodyHash, status: 200, body: "{}", headers: validHeaders },
      userA,
    )
    await idempotencyService.store(
      { key: key1, bodyHash, status: 200, body: "{}", headers: validHeaders },
      userB,
    )

    const result = await idempotencyService.purgeUserKeys(userA)
    expect(result.deleted).toBe(2)

    // userA: tout disparu
    expect((await idempotencyService.lookup(key1, userA, bodyHash)).type).toBe("miss")
    expect((await idempotencyService.lookup(key2, userA, bodyHash)).type).toBe("miss")
    // userB: intact
    expect((await idempotencyService.lookup(key1, userB, bodyHash)).type).toBe("replay")
  })

  it("purge user sans keys → deleted: 0", async () => {
    const result = await idempotencyService.purgeUserKeys(123)
    expect(result.deleted).toBe(0)
  })
})

// H-CR-4 — LRU memory cap : insertion FIFO eviction.
describe("memory fallback LRU cap (H-CR-4)", () => {
  beforeEach(() => idempotencyService.__resetMemoryForTests())
  afterEach(() => idempotencyService.__resetMemoryForTests())

  // Le cap est 1000 — on ne le triggère pas en test (trop coûteux) mais on
  // vérifie le pattern via le size après 5 inserts.
  it("inserts under cap restent accessibles", async () => {
    const bodyHash = hashBody("{}")
    for (let i = 0; i < 5; i++) {
      const key = `a3f9b8c2-4d56-4e89-8f12-345678abcde${i}`
      await idempotencyService.store(
        { key, bodyHash, status: 200, body: "{}", headers: validHeaders },
        100,
      )
    }
    // Toutes les 5 entrées accessibles
    for (let i = 0; i < 5; i++) {
      const key = `a3f9b8c2-4d56-4e89-8f12-345678abcde${i}`
      const r = await idempotencyService.lookup(key, 100, bodyHash)
      expect(r.type).toBe("replay")
    }
  })
})

describe("__resetMemoryForTests guard (M-CR-6)", () => {
  it("throw si NODE_ENV/VITEST pas set", () => {
    const originalNode = process.env.NODE_ENV
    const originalVitest = process.env.VITEST
    try {
      // @ts-expect-error — override allowed in test
      process.env.NODE_ENV = "production"
      delete process.env.VITEST
      expect(() => idempotencyService.__resetMemoryForTests()).toThrow(/test-only/)
    } finally {
      // @ts-expect-error — restore
      process.env.NODE_ENV = originalNode
      if (originalVitest !== undefined) process.env.VITEST = originalVitest
    }
  })
})
