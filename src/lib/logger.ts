/**
 * @module logger
 * @description Structured logger for server-side code (API routes, services, middleware).
 *
 * Output format:
 * - **Production** (`NODE_ENV=production`): single-line JSON — machine-parseable for
 *   Grafana Loki / OVH Logs Data Platform.
 * - **Development/test**: human-readable plain text with level prefix.
 *
 * Correlation: each log entry can carry a `requestId` so related log lines across
 * services can be joined. The middleware assigns/echoes an `x-request-id` header
 * per request; `extractRequestContext(req).requestId` exposes it to route code.
 *
 * Usage:
 *   logger.error("auth/login", "bcrypt compare failed", { requestId, userId })
 *   logger.warn("insulin/bolus", "IOB config corrupt", { requestId, patientId })
 *
 * Never log plaintext health data — route through the audit service instead,
 * which enforces HDS immutability (see audit.service.ts).
 */

type LogLevel = "error" | "warn" | "info" | "debug"

export interface LogContext {
  requestId?: string
  userId?: number
  patientId?: number
  /** Free-form extension fields. Must not contain plaintext health data. */
  [key: string]: unknown
}

const IS_PRODUCTION = process.env.NODE_ENV === "production"
const IS_TEST = process.env.NODE_ENV === "test" || process.env.VITEST === "true"

// Keep the payload small in prod — Grafana ingestion has per-line limits.
function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (!err) return undefined
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      // Stack intentionally omitted in prod to avoid leaking file paths in logs.
      ...(IS_PRODUCTION ? {} : { stack: err.stack }),
    }
  }
  return { value: String(err) }
}

function emit(
  level: LogLevel,
  scope: string,
  message: string,
  context: LogContext = {},
  error?: unknown,
): void {
  // Tests: suppress non-error levels to keep test output clean.
  if (IS_TEST && level !== "error") return

  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...context,
  }
  if (error !== undefined) {
    entry.error = serializeError(error)
  }

  const stream = level === "error" ? console.error : console.warn
  if (IS_PRODUCTION) {
    stream.call(console, JSON.stringify(entry))
  } else {
    const ctxText = Object.keys(context).length ? " " + JSON.stringify(context) : ""
    const errText = error ? ` ${error instanceof Error ? error.message : String(error)}` : ""
    stream.call(console, `[${level}][${scope}] ${message}${ctxText}${errText}`)
  }
}

export const logger = {
  error: (scope: string, message: string, context?: LogContext, error?: unknown) =>
    emit("error", scope, message, context, error),
  warn: (scope: string, message: string, context?: LogContext) =>
    emit("warn", scope, message, context),
  info: (scope: string, message: string, context?: LogContext) =>
    emit("info", scope, message, context),
  debug: (scope: string, message: string, context?: LogContext) =>
    emit("debug", scope, message, context),
} as const
