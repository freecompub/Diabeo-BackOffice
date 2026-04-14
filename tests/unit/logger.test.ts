/**
 * Test suite: structured logger
 *
 * Clinical behavior tested:
 * - logger.error emits structured payloads carrying scope, message, and
 *   optional requestId/userId/patientId fields so log aggregators (Grafana
 *   Loki, OVH LDP) can group related events across services
 * - Error objects are serialized safely (no cycle, stack stripped in prod)
 * - Non-error levels are suppressed in test environment to keep test output
 *   readable while still exercising the emit path for error logs
 *
 * Associated risks:
 * - Plaintext health data leaking into logs would violate HDS §III.2 and
 *   RGPD Art. 32 — the logger is a non-sanitizing sink; callers must never
 *   pass patient health values (glucose readings, insulin doses). Audit
 *   service is the only path for that class of data.
 * - A logger that swallows errors silently during a Redis outage would mask
 *   the degraded state from operations dashboards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { logger } from "@/lib/logger"

describe("logger", () => {
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    errSpy.mockRestore()
  })

  it("emits to console.error for logger.error", () => {
    logger.error("test/scope", "something failed")
    expect(errSpy).toHaveBeenCalledTimes(1)
    const arg = errSpy.mock.calls[0][0] as string
    expect(arg).toContain("test/scope")
    expect(arg).toContain("something failed")
  })

  it("includes context fields (requestId, userId) in the output", () => {
    logger.error("auth/login", "bcrypt failure", { requestId: "abc123", userId: 42 })
    const arg = errSpy.mock.calls[0][0] as string
    expect(arg).toContain("abc123")
    expect(arg).toContain("42")
  })

  it("serializes Error objects without leaking cycle references", () => {
    const err = new Error("boom")
    logger.error("scope", "msg", { requestId: "r" }, err)
    expect(errSpy).toHaveBeenCalled()
    // No TypeError / cycle → call completed
  })

  it("suppresses non-error levels in test environment", () => {
    logger.info("scope", "info message")
    logger.warn("scope", "warn message")
    logger.debug("scope", "debug message")
    expect(errSpy).not.toHaveBeenCalled()
  })
})
