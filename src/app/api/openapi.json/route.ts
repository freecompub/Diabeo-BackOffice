/**
 * GET /api/openapi.json — public OpenAPI 3.1 spec
 *
 * Built on-demand from the Zod schemas in `src/lib/openapi/routes.ts`.
 * No caching (the cost is a handful of ms for ~15 schemas) — the spec
 * stays in lockstep with the running code.
 *
 * Unauthenticated: tools like `swagger-ui-cli` and Postman need to fetch
 * the spec without a session; middleware explicitly skips this path.
 */

import { NextResponse } from "next/server"
import { buildOpenApiDocument } from "@/lib/openapi/spec"
import { OPENAPI_ROUTES } from "@/lib/openapi/routes"

// Defensive: pin the runtime to Node.js. The builder works in Edge today
// but `@/lib/schemas/account` imports Prisma-generated enums (Sex, Language,
// Pathology) that are Node-only, so an accidental `runtime = "edge"` would
// fail at request time, not build time.
export const runtime = "nodejs"

// Opt out of Next.js Full Route Cache. The handler is synchronous and could
// otherwise be statically rendered + cached at build time; we want the spec
// to reflect the running code, not a cached snapshot.
export const dynamic = "force-dynamic"

export function GET() {
  const doc = buildOpenApiDocument(OPENAPI_ROUTES)
  return NextResponse.json(doc, {
    headers: {
      // Browsers cache by default; disable so dev-env changes surface immediately.
      "Cache-Control": "no-store",
    },
  })
}
