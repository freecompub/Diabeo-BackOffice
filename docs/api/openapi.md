# OpenAPI Specification

The backoffice exposes an OpenAPI 3.1 document at
**`GET /api/openapi.json`** — public, no authentication required.

The spec is built on-demand from the Zod schemas in
`src/lib/openapi/routes.ts` via Zod 4's native `z.toJSONSchema()`. No
third-party converter → no version-drift risk when Zod releases a major.

## Viewing the spec

### Swagger UI (CLI)

```sh
curl -s http://localhost:3000/api/openapi.json | npx swagger-ui-cli
```

Opens a local browser tab with the interactive UI.

### Postman

File → Import → Link → paste `https://app.diabeo.fr/api/openapi.json`.
Postman generates a collection with one request per route.

### Redocly

```sh
npx @redocly/cli preview-docs http://localhost:3000/api/openapi.json
```

### Client code generation

The spec is compatible with any OpenAPI 3.1 codegen tool:

- iOS (Swift): `openapi-generator generate -g swift6 -i <url>`
- TypeScript: `openapi-typescript <url> --output src/api-types.ts`

## Current coverage

This is a **starter spec** covering 15 routes. Full coverage (60+ routes)
is being added progressively to keep each diff reviewable. Registered today:

| Group | Routes |
|---|---|
| Auth | login, logout, refresh, reset-password |
| Auth / MFA | setup, verify, challenge, disable |
| Account | GET + PUT `/api/account`, GET + PUT `/api/account/privacy` |
| Monitoring | `/api/health` |

Not yet in the spec: analytics, patient, insulin-therapy, CGM, events,
devices, documents, appointments, push notifications, admin audit logs.
Tracked via the `openapi:` label on follow-up PRs.

## Adding a route

1. Open `src/lib/openapi/routes.ts`.
2. Append a `RouteDefinition` to the appropriate array (auth / mfa /
   account / etc. — or create a new section).
3. Use the **same Zod schema** as the actual route handler wherever
   possible. This prevents spec drift from runtime validation.
4. Describe every status code the handler returns (200, 400, 401, 429,
   etc.) with a short description + a response schema if the body has one.
5. Tag the route so Swagger UI groups it sensibly.
6. Run `pnpm test tests/unit/openapi-spec.test.ts` — the "includes every
   route from the registry" test confirms your addition is picked up.

## Security schemes

Three schemes are declared:

- **`bearerJwt`** — full-access RS256 JWT (15 min TTL, audience
  `diabeo-hc`). Header `Authorization: Bearer <token>`.
- **`cookieJwt`** — same JWT delivered via the httpOnly cookie
  `diabeo_token` (browser clients).
- **`mfaPending`** — short-lived (5 min) JWT with audience
  `diabeo-mfa-pending`. Only `/api/auth/mfa/challenge` accepts it.
  Rejected on every protected route.

## Conventions

- Responses with a JSON body declare a Zod schema. Empty responses omit
  `schema`.
- Error responses use `ErrorResponse` (`{ error: string }`) unless the
  route emits a richer payload (e.g. `ValidationError` with `details`).
- Path parameters are always required per OpenAPI 3.1 — handled
  automatically by the builder.
- `/api/health` and `/api/openapi.json` are the only public endpoints.
  Middleware normalizes the path (lowercase + strip trailing slash) so
  misconfigured monitors don't fall through to JWT enforcement.
