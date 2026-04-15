/**
 * @module openapi/spec
 * @description OpenAPI 3.1 document builder, powered by Zod 4's native
 * `z.toJSONSchema()`. No third-party converter dependency — avoids the
 * version-drift risk of `zod-to-openapi` packages that need to catch up
 * with Zod majors.
 *
 * How to view:
 *
 *     curl -s https://app.diabeo.fr/api/openapi.json | npx swagger-ui-cli
 *
 * or import into Postman: File → Import → Link → paste the URL.
 */

import { z, type ZodType } from "zod"
import type { RouteDefinition } from "./routes"

/** Project version — surfaced in the spec's `info.version`. */
const API_VERSION = "0.1.0"

/**
 * OpenAPI security-scheme IDs referenced by `RouteDefinition.auth`.
 *
 * Note: the mfa-pending token used by /api/auth/mfa/challenge is NOT a
 * security scheme — it's a body parameter (`mfaToken`) documented as
 * part of the request body. OpenAPI security schemes model transport
 * concerns (header, cookie, query), not business-level fields.
 */
export const SECURITY_SCHEMES = {
  bearerJwt: "bearerJwt",
  cookieJwt: "cookieJwt",
} as const

export type SecuritySchemeId = keyof typeof SECURITY_SCHEMES

/** Minimal OpenAPI 3.1 types we care about. Keeps the surface small. */
export interface OpenApiDocument {
  openapi: "3.1.0"
  info: { title: string; version: string; description?: string }
  servers: Array<{ url: string; description: string }>
  paths: Record<string, Record<string, OpenApiOperation>>
  components: {
    securitySchemes: Record<string, OpenApiSecurityScheme>
    schemas: Record<string, unknown>
  }
}

interface OpenApiOperation {
  summary: string
  description?: string
  tags?: string[]
  security?: Array<Record<string, string[]>>
  parameters?: OpenApiParameter[]
  requestBody?: {
    required: boolean
    content: Record<string, { schema: unknown }>
  }
  responses: Record<
    string,
    { description: string; content?: Record<string, { schema: unknown }> }
  >
}

interface OpenApiParameter {
  name: string
  in: "query" | "path" | "header"
  required: boolean
  schema: unknown
  description?: string
}

interface OpenApiSecurityScheme {
  type: "http" | "apiKey"
  scheme?: "bearer"
  bearerFormat?: "JWT"
  in?: "cookie" | "header"
  name?: string
  description?: string
}

/**
 * Convert a Zod schema to a JSON Schema compatible with OpenAPI 3.1.
 * OpenAPI 3.1 supports JSON Schema draft 2020-12 natively, so Zod 4's
 * default output is drop-in compatible.
 */
export function zodToOpenApiSchema(schema: ZodType): unknown {
  return z.toJSONSchema(schema, { target: "draft-2020-12" })
}

/** Minimal shape we narrow to when we know the input was a `z.object`. */
interface ObjectJsonSchema {
  properties?: Record<string, unknown>
  required?: string[]
}

/**
 * Convert + narrow a Zod object schema to its property/required surface.
 * Use only when the source schema is known to be a `z.object` (body / query
 * / pathParams), so we can iterate `properties` to emit OpenAPI parameters.
 *
 * Throws at registration time if the source is not a ZodObject — prevents
 * the silent footgun of registering a `z.union` / `z.array` as `query`
 * which would emit zero OpenAPI parameters with no warning.
 */
function zodToObjectJsonSchema(schema: ZodType): ObjectJsonSchema {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(
      `OpenAPI builder: query / pathParams must be a z.object, got ${schema.constructor.name}. ` +
      `Use z.object({...}) so each field can be emitted as a separate parameter.`,
    )
  }
  return zodToOpenApiSchema(schema) as ObjectJsonSchema
}

/**
 * Build the OpenAPI document from a route registry.
 * Pure function — callers pass the registry, the builder assembles the doc.
 */
export function buildOpenApiDocument(routes: RouteDefinition[]): OpenApiDocument {
  const paths: OpenApiDocument["paths"] = {}

  for (const route of routes) {
    paths[route.path] ??= {}

    const op: OpenApiOperation = {
      summary: route.summary,
      description: route.description,
      tags: route.tags,
      responses: {}, // filled below; OpenAPI requires responses to be present
    }

    if (route.auth && route.auth.length > 0) {
      op.security = route.auth.map((scheme) => ({ [scheme]: [] }))
    }

    const parameters: OpenApiParameter[] = []
    if (route.query) {
      const jsonSchema = zodToObjectJsonSchema(route.query)
      for (const [name, schema] of Object.entries(jsonSchema.properties ?? {})) {
        parameters.push({
          name,
          in: "query",
          required: jsonSchema.required?.includes(name) ?? false,
          schema,
        })
      }
    }
    if (route.pathParams) {
      const jsonSchema = zodToObjectJsonSchema(route.pathParams)
      for (const [name, schema] of Object.entries(jsonSchema.properties ?? {})) {
        parameters.push({
          name,
          in: "path",
          required: true, // path params are always required in OpenAPI
          schema,
        })
      }
    }
    if (parameters.length > 0) op.parameters = parameters

    if (route.body) {
      op.requestBody = {
        required: true,
        content: {
          "application/json": { schema: zodToOpenApiSchema(route.body) },
        },
      }
    }

    for (const [statusCode, resp] of Object.entries(route.responses)) {
      op.responses[statusCode] = {
        description: resp.description,
        ...(resp.schema
          ? { content: { "application/json": { schema: zodToOpenApiSchema(resp.schema) } } }
          : {}),
      }
    }

    paths[route.path][route.method.toLowerCase()] = op
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Diabeo Backoffice API",
      version: API_VERSION,
      description: "HDS-compliant API for insulin-therapy management.",
    },
    servers: [
      { url: "https://app.diabeo.fr", description: "Production" },
      { url: "https://staging.diabeo.fr", description: "Recette (pre-prod)" },
      { url: "http://localhost:3000", description: "Local development" },
    ],
    paths,
    components: {
      securitySchemes: {
        [SECURITY_SCHEMES.bearerJwt]: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Session token sent as a Bearer Authorization header.",
        },
        [SECURITY_SCHEMES.cookieJwt]: {
          // Keep the cookie name stable (clients need to know which cookie
          // to forward) but do NOT document internal token claims.
          type: "apiKey",
          in: "cookie",
          name: "diabeo_token",
          description: "Session token delivered as an httpOnly cookie.",
        },
      },
      // Reserved for shared response components in a future PR (errors,
      // pagination envelopes). Currently empty — each route inlines its schemas.
      schemas: {},
    },
  }
}
