/**
 * GET /api/health — public health check
 *
 * Exposed at the edge for:
 * - OVH Cloud Monitoring external pings (every 30 s).
 * - Deployment pipeline smoke tests (runbook §Deployment).
 * - Incident response triage (runbook §Monitoring + incident-response.md).
 *
 * Intentionally unauthenticated: an outage must be detectable without a
 * valid JWT. Keeps the response body minimal — no PII, no internal config,
 * no version details that would leak attack surface to unauthenticated
 * callers (the `version` field is the short git sha, which is already
 * exposed in source-map URLs and GitHub).
 */

import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/client"
import { cacheGet } from "@/lib/cache/redis-cache"

type ComponentStatus = "ok" | "down"
type OverallStatus = "ok" | "degraded" | "down"

interface HealthResponse {
  status: OverallStatus
  db: ComponentStatus
  redis: ComponentStatus
  version: string
}

/** Short commit SHA injected at build time (runbook expects this). */
const VERSION = (process.env.GIT_COMMIT_SHA ?? "dev").slice(0, 7)

/** 1 s upper bound on each subsystem probe — don't let a slow DB block the health endpoint. */
const PROBE_TIMEOUT_MS = 1000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms)),
  ])
}

async function probeDb(): Promise<ComponentStatus> {
  try {
    const result = await withTimeout(
      prisma.$queryRaw`SELECT 1`,
      PROBE_TIMEOUT_MS,
    )
    return result === "timeout" ? "down" : "ok"
  } catch {
    return "down"
  }
}

async function probeRedis(): Promise<ComponentStatus> {
  // Reuse the generic cache helper: a get on a sentinel key. Fails-open on
  // Redis errors (logs but does not throw), so we probe the underlying
  // connection by checking whether the call completes within the timeout.
  try {
    const result = await withTimeout(
      cacheGet<string>("health", "probe"),
      PROBE_TIMEOUT_MS,
    )
    return result === "timeout" ? "down" : "ok"
  } catch {
    return "down"
  }
}

export async function GET() {
  const [db, redis] = await Promise.all([probeDb(), probeRedis()])

  // Overall: DB down is catastrophic — nothing works. Redis down is
  // degraded: rate limiting falls back to in-memory, session revocation
  // is fail-closed (HDS), GDPR cache misses fall back to Prisma.
  const status: OverallStatus =
    db === "down" ? "down" : redis === "down" ? "degraded" : "ok"

  const body: HealthResponse = { status, db, redis, version: VERSION }
  // Monitoring wants non-200 on degraded/down so alert thresholds fire.
  const httpStatus = status === "ok" ? 200 : 503
  return NextResponse.json(body, { status: httpStatus })
}
