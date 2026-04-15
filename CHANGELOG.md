# Changelog

All notable changes to the Diabeo Backoffice are tracked here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: semantic where possible; early POC phase does not cut tagged
releases, so entries are grouped by merged PR and calendar date.

## [Unreleased]

## 2026-04-15 — OpenAPI 3.1 spec (starter coverage)

### Added

- **`GET /api/openapi.json`** (public, no auth) — OpenAPI 3.1 document
  built on-demand from the Zod schemas via Zod 4's native
  `z.toJSONSchema()`. No third-party converter dependency.
- `src/lib/openapi/spec.ts` — document builder with three security
  schemes (`bearerJwt`, `cookieJwt`, `mfaPending`).
- `src/lib/openapi/routes.ts` — declarative registry, 15 starter routes
  covering auth, MFA, account profile/privacy, and `/api/health`.
- `docs/api/openapi.md` — how to view the spec (swagger-ui-cli, Postman,
  Redocly) and how to register additional routes.
- Middleware `PUBLIC_ENDPOINTS` set: `/api/health` + `/api/openapi.json`.

### Changed

- Middleware public-endpoint check refactored from per-path `if` into a
  `Set` lookup — easier to add future public routes (e.g. a hosted
  Swagger UI page) without touching the JWT enforcement branch.

## 2026-04-15 — Ops docs + health endpoint

### Added

- **`GET /api/health`** (`src/app/api/health/route.ts`) — public health
  probe used by OVH Cloud Monitoring and deployment smoke tests. Returns
  `{ status, db, redis, version }` with 200 on `ok`, 503 on `degraded` /
  `down`. 1 s timeout per subsystem probe; stalled DB is reported down
  instead of hanging the endpoint. Middleware explicitly skips this route
  so monitoring stays reachable during auth outages.
- **Operations documentation** (PR #107):
  - `docs/operations/runbook.md` — deploy/rollback, migrations, backups,
    secret rotation, monitoring, maintenance cadence.
  - `docs/operations/incident-response.md` — 8 HDS/RGPD playbooks
    (Redis outage, DB compromise, MFA bypass, rate-limit storm, key
    compromise, stolen cookie, third-party CVE) + incident-log template.
  - `docs/operations/scripts-index.md` — inventory of operational
    scripts / alerts with implementation status (✓ / ✗ TODO).
  - `CHANGELOG.md` (this file) — retroactive coverage of PRs #103-#106.

### Changed

- `docs/api/routes-summary.md` — added MFA routes, rate-limit flags on
  analytics, pro-access `?patientId=` note, dual-bucket export, and the
  new `/api/health` row.
- `docs/compliance/hds-rgpd.md` — grouped `AuditAction` union
  (access/export/security/mfa/business), documented `AuditLog.requestId`
  correlation, GDPR cache TTL strategy, Art. 17 delete sequence with
  MFA reset + cache invalidation, and a new **Authentification forte —
  MFA TOTP** section (HDS guarantees, JWT audience split, disable
  double-factor requirement).

## 2026-04-14 — Backlog cleanup wave

### Added

- **MFA TOTP second factor** (PR #106, a675b99)
  - RFC 6238 TOTP with encrypted-at-rest secret (AES-256-GCM) and replay
    protection via `User.mfaLastUsedStep` + Prisma optimistic CAS.
  - New routes: `POST /api/auth/mfa/{setup,verify,challenge,disable}`.
  - Login flow on `mfaEnabled=true` now returns `{ mfaRequired, mfaToken }`
    (5 min mfa-pending JWT with distinct audience) instead of a full JWT.
  - New audit actions: `MFA_SETUP_INITIATED`, `MFA_ENABLED`, `MFA_DISABLED`,
    `MFA_CHALLENGE_FAILED`.
  - `Session.mfaVerified` flag so HDS forensics can tell second-factor
    sessions apart from password-only ones.
  - Migration SQL: `prisma/sql/mfa_hardening.sql`.
  - Docs: `docs/security/mfa-flow.md`.
- **Structured logger** (`src/lib/logger.ts`) with per-request correlation
  ID echoed via `x-request-id` header (PR #105).
  - JSON output in production, plain text in dev, error-only in test.
  - Strict allow-list of context keys + PII redactor (email, JWT, NIR,
    Bearer) on error messages — HDS §III.2 / RGPD Art. 32 safeguard.
- **GDPR consent cache** (`src/lib/cache/redis-cache.ts`) — 60 s TTL for
  positive consent, 300 s for negative; invalidated on privacy updates and
  account deletion (RGPD Art. 7(3)). Offloads 52+ routes from per-request
  Prisma queries.
- **API rate limiting** (PR #103) — atomic Lua `INCR+EXPIRE+TTL` via Upstash;
  fail-open presets for analytics (30 req/min), fail-closed for RGPD export
  (3/h user + 10/h IP with dual-bucket sequential check).
- **Per-request correlation ID on audit logs** — new `AuditLog.requestId`
  column (PR #105, migration `prisma/sql/audit_log_request_id.sql`).

### Changed

- `/api/auth/login` returns HTTP 200 `{ mfaRequired, mfaToken }` when the
  user has MFA enabled, instead of HTTP 403 `{ error: "mfaRequired" }`.
  **Breaking for clients that branch on status code** — iOS app requires
  coordination (see `docs/security/mfa-flow.md` "iOS wiring").
- `AverageData.periodType` migrated from `VARCHAR(10)` to Prisma enum
  `PeriodType { current, d7, d30 }` (@map preserves existing DB values).
  Migration: `prisma/sql/period_type_enum.sql`.
- 16 Phase 3/4 patient routes now accept `?patientId=` from DOCTOR/NURSE
  (previously patient-only via `getOwnPatientId`) — access gated by
  `resolvePatientIdFromQuery` → `canAccessPatient` (PR #103).
- `InsulinDeliveryMethod` enum now strictly typed in `BolusResult` and
  `roundForDevice` with exhaustive `assertNever` default — future enum
  additions fail at compile time (PR #104).
- Prisma `Decimal` fields in insulin + analytics services now use
  `.toNumber()` instead of `Number()` (prevents silent NaN on nullables).
- `Session.createSession` accepts optional `{ mfaVerified }`; default false.

### Fixed

- **CRITICAL — IOB actionDurationHours falsy-zero coercion** (PR #104):
  a stored `Decimal(0)` was silently rewritten to 4 h default via `||`,
  disabling IOB subtraction → insulin stacking risk. Now `??` + explicit
  `<= 0` throw emits `CONFIG_ERROR` audit and surfaces as HTTP 422
  `invalidTherapyConfig`.
- **CRITICAL — TOTP replay** (PR #106): same OTP was reusable across
  `/challenge` → `/disable` within its 60 s validity window. Replay guard
  via `mfaLastUsedStep` + optimistic CAS makes each code single-use.
- **CRITICAL — MFA state inconsistent after RGPD delete** (PR #106):
  anonymization cleared `mfaSecret` but left `mfaEnabled=true` and
  `mfaLastUsedStep`. Both now reset alongside the secret.
- **MAJOR — dual-bucket export quota leak** (PR #103): `Promise.all` on
  user + IP rate-limit incremented both counters even when one blocked,
  burning user budget on noisy IPs. Now sequential short-circuit.
- **MAJOR — `/api/auth/login` → 500 instead of 422 on corrupt therapy
  config** (PR #104): added `InvalidTherapyConfigError` + dedicated
  mapping in `calculate-bolus/route.ts`.

### Security

- **ESLint `@typescript-eslint/prefer-nullish-coalescing`** enforced on
  `src/` (`ignorePrimitives` for boolean/string). Would have caught the
  original `|| 4.0` IOB bug at authoring time.
- **Audit log cross-confusion**: introduced `RATE_LIMITED`, `CONFIG_ERROR`,
  and `MFA_*` AuditActions to stop reusing `UNAUTHORIZED` for non-auth
  events — cleans SIEM / breach-notification (RGPD Art. 33) triage.
- **x-request-id sanitization**: middleware validates client-supplied
  correlation IDs against `/^[A-Za-z0-9-]{1,64}$/` — prevents log
  injection / smuggling against grep/awk/SIEM pipelines.
- **JWT audience split**: mfa-pending tokens use `diabeo-mfa-pending`
  audience, rejected by protected-route middleware. Cross-confusion
  attack tests assert both directions.
- **Export RGPD fail-closed**: a Redis outage no longer turns the 3/h
  export cap into an unbounded data-exfiltration channel if a session
  token is stolen. Skips audit DB write when `degraded=true` to avoid
  compounding outage with a Postgres write storm.

### Deprecated

- `INSULIN_BOUNDS` alias in `insulin-therapy.service.ts` — use
  `CLINICAL_BOUNDS` from `src/lib/clinical-bounds.ts` instead (single
  source of truth).

---

## 2026-03 — Phase 11 closing

### Added

- Phase 11.2 web screens (PR #100, #101) — 9-screen catalog with RTL
  support, accessibility pass, and real-flow tests.

### Fixed

- Post-merge findings on PR #100/#101 — code, RTL, test suite hardening.

---

## Earlier history

PRs #1-#99 covered the foundational phases of the backoffice:

- Phase 0 — schema (48 tables × 11 domains), crypto helpers, audit service
- Phase 1 — auth (JWT RS256, sessions, rate limit, reset-password stub)
- Phase 2 — patient profile + medical data + objectives + pregnancy
- Phase 3 — CGM, diabetes events, analytics (AGP, TIR, hypo, insulin summary)
- Phase 4 — insulin therapy settings (ISF, ICR, basal config, pump slots,
  bolus calculation log with clinical bounds + IOB)
- Phase 5 — appointments, documents, announcements
- Phase 6 — push notifications
- Phase 7 — devices + MyDiabby sync (recette only)
- Phase 8 — dashboard UI, component library, Storybook setup
- Phase 9 — BDPM (drug reference) integration
- Phase 10 — adjustment proposals (doctor review workflow)
- Phase 11 — full web UI pages

Individual changes are traceable through the git log (`git log`) and
`gh pr list --state merged`.
