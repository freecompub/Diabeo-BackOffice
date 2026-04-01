# Diabeo Backoffice -- Test Suite

## Running Tests

```bash
# Run all tests once
pnpm test

# Run tests in watch mode (re-runs on file changes)
pnpm test:watch

# Run tests with coverage report
pnpm test:coverage

# Run a specific test file
pnpm test -- tests/unit/insulin.service.test.ts

# Run tests matching a pattern
pnpm test -- -t "bolus"
```

## Test Framework: Vitest

We chose **Vitest** over Jest for the following reasons:

- **Native ESM support** -- Next.js 16 uses ESM by default; Vitest handles it without transform hacks
- **Faster execution** -- Vitest uses Vite's transform pipeline and runs tests in parallel by default
- **TypeScript out of the box** -- No need for ts-jest or babel transforms
- **Compatible configuration** -- Uses the same `resolve.alias` as Vite, so `@/` path aliases work natively
- **API compatible** -- Same `describe/it/expect` API as Jest, minimal learning curve

## Test Categories

### Unit Tests (`tests/unit/`)

Tests that run in isolation with all external dependencies mocked (database, network, etc.).

| File | What it tests | Priority |
|------|--------------|----------|
| `insulin.service.test.ts` | Bolus calculation engine -- meal bolus, correction dose, clinical caps, warnings, time slot selection | **CRITICAL** (patient safety) |
| `crypto.test.ts` | AES-256-GCM encrypt/decrypt roundtrip, random IV, invalid key, corrupted data | **HIGH** (HDS compliance) |
| `audit.service.test.ts` | Audit log creation, query filters, pagination, request context extraction | **HIGH** (HDS compliance) |
| `patient.service.test.ts` | Patient CRUD with encryption, soft delete with RGPD anonymization | **HIGH** (HDS + RGPD) |
| `validation.test.ts` | Zod schema validation for API query parameters | MEDIUM |

### Integration Tests (`tests/integration/`) -- PLANNED

Tests that use a real PostgreSQL database (Docker) to verify Prisma queries, transactions, and data integrity.

Planned:
- `patient.integration.test.ts` -- Full CRUD cycle with real DB
- `insulin.integration.test.ts` -- Bolus calculation with real settings from DB
- `audit.integration.test.ts` -- Immutability enforcement via DB trigger

### End-to-End Tests (`tests/e2e/`) -- PLANNED (Phase 2+)

Playwright tests for the web UI once pages are implemented.

Planned:
- Login flow with MFA
- Patient list and detail views
- Insulin configuration editor
- Audit log viewer (admin)

## Test Helpers

### `tests/helpers/setup.ts`

Global setup that runs before all test files. Sets the `HEALTH_DATA_ENCRYPTION_KEY` environment variable to a test-only key. This key is NOT used in production.

### `tests/helpers/prisma-mock.ts`

Creates a deep mock of PrismaClient using `vitest-mock-extended`. Import `prismaMock` in any test file to configure database responses. The mock is auto-reset between tests.

```typescript
import { prismaMock } from "../helpers/prisma-mock"

prismaMock.patient.findFirst.mockResolvedValue({ id: 1, ... })
```

## Coverage Thresholds

Configured in `vitest.config.ts`:

| Metric | Threshold | Current |
|--------|-----------|---------|
| Statements | 80% | 96% |
| Branches | 75% | 98% |
| Functions | 80% | 93% |
| Lines | 80% | 96% |

Coverage is enforced on CI -- the test command will fail if thresholds are not met.

## Writing New Tests

1. **Service tests**: Import the service, import `prismaMock` from helpers, configure mock return values
2. **Crypto tests**: No mocks needed -- tests use the real crypto module with a test key
3. **Validation tests**: Recreate the Zod schema in the test file to test in isolation
4. **Always**: Reset timers with `vi.useRealTimers()` in `beforeEach` if using `vi.useFakeTimers()`
