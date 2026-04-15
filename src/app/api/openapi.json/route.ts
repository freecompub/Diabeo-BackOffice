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

export function GET() {
  const doc = buildOpenApiDocument(OPENAPI_ROUTES)
  return NextResponse.json(doc, {
    headers: {
      // Browsers cache by default; disable so dev-env changes surface immediately.
      "Cache-Control": "no-store",
    },
  })
}
