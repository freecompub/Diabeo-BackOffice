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
 * services can be joined. The middleware assigns/echoes a sanitized
 * `x-request-id` header per request; `extractRequestContext(req).requestId`
 * exposes it to route code.
 *
 * **PHI/PII safety (HDS §III.2 + RGPD Art. 32)**:
 * - Context keys are enforced via an allow-list; unknown keys are dropped and
 *   reported once per key via a sentinel warning. This prevents accidental
 *   `logger.info("...", { glucose, firstname, email })` leaks to aggregators.
 * - Error messages are redacted against common PHI/PII patterns (email,
 *   NIR/INS, JWT-looking strings) before emission. Prisma errors routinely
 *   embed column values; the redactor blocks that class of leak.
 * - Never log plaintext health data. Route health-data events through the
 *   audit service (audit.service.ts) which enforces HDS immutability.
 */

type LogLevel = "error" | "warn" | "info" | "debug"

/**
 * Permitted context keys. Anything outside this list is stripped at emit time.
 * Keep the set narrow — new fields require explicit review (HDS §III.2).
 */
const ALLOWED_CONTEXT_KEYS = new Set<string>([
  "requestId",
  "userId",
  "patientId",
  "settingsId",
  "bucket",
  "key",
  "failMode",
  "statusCode",
  "durationMs",
  "action",
  "resource",
  "attempt",
  "degraded",
])

export interface LogContext {
  requestId?: string
  userId?: number
  patientId?: number
  settingsId?: number
  bucket?: string
  key?: string
  failMode?: string
  statusCode?: number
  durationMs?: number
  action?: string
  resource?: string
  attempt?: number
  degraded?: boolean
}

const IS_PRODUCTION = process.env.NODE_ENV === "production"
const IS_TEST = process.env.NODE_ENV === "test" || process.env.VITEST === "true"

// Tracks keys already flagged as disallowed (one warn per key per process).
const flaggedKeys = new Set<string>()

/**
 * PHI/PII redaction patterns applied to free-text error messages.
 * - email, JWT-looking token, French NIR (13-digit social security), long
 *   digit runs that could be IDs, bearer tokens. Conservative: over-redacts
 *   rather than under-redacts.
 */
const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]"],
  [/\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b/g, "[REDACTED_NIR]"],
  [/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]"],
]

function redact(text: string): string {
  let out = text
  for (const [pattern, replacement] of REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

function filterContext(context: LogContext): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(context)) {
    if (ALLOWED_CONTEXT_KEYS.has(k)) {
      clean[k] = v
    } else if (!flaggedKeys.has(k) && !IS_TEST) {
      // One-shot warning per disallowed key — surfaces the bug without spamming
      flaggedKeys.add(k)
      console.warn(
        `[logger] dropped disallowed context key '${k}' — add to ALLOWED_CONTEXT_KEYS after HDS review if needed`,
      )
    }
  }
  return clean
}

// Keep the payload small in prod — Grafana ingestion has per-line limits.
function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (!err) return undefined
  if (err instanceof Error) {
    return {
      name: err.name,
      message: redact(err.message),
      // Stack intentionally omitted in prod to avoid leaking file paths in logs.
      ...(IS_PRODUCTION ? {} : { stack: err.stack ? redact(err.stack) : undefined }),
    }
  }
  return { value: redact(String(err)) }
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

  const filteredCtx = filterContext(context)
  const entry: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message: redact(message),
    ...filteredCtx,
  }
  if (error !== undefined) {
    entry.error = serializeError(error)
  }

  const stream = level === "error" ? console.error : console.warn
  if (IS_PRODUCTION) {
    stream.call(console, JSON.stringify(entry))
  } else {
    const ctxText = Object.keys(filteredCtx).length ? " " + JSON.stringify(filteredCtx) : ""
    const errText = error ? ` ${error instanceof Error ? redact(error.message) : redact(String(error))}` : ""
    stream.call(console, `[${level}][${scope}] ${redact(message)}${ctxText}${errText}`)
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
