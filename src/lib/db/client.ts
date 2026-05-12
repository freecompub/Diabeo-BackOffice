import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

// Prisma 7 — `new PrismaClient()` requiert un adapter (legacy "library" engine
// supprimé). `@prisma/adapter-pg` utilise `node-postgres` (pg) côté Node, ce
// qui :
//  - élimine le binaire Rust qui posait des soucis de cold-start serverless,
//  - permet d'utiliser le pooling pg-native si besoin,
//  - est la voie officielle Prisma 7+ (cf. validatePrismaClientOptions.ts qui
//    impose `adapter` ou `accelerateUrl`).
//
// La connexion réelle est définie par `DATABASE_URL` env var, lu par PrismaPg.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required to instantiate PrismaClient. " +
        "See docs/local-development.md §3.",
    )
  }
  // L1 — wrap dans try/catch et scrub la connection string de l'éventuel
  // message d'erreur. `pg`/`PrismaPg` peuvent inclure la URL (user:password@host)
  // dans leur erreur de parse → fuite credentials dans APM/Sentry.
  let adapter: PrismaPg
  try {
    adapter = new PrismaPg({ connectionString })
  } catch {
    // Pas de re-throw avec `{ cause: err }` — le message original peut
    // contenir l'URL en clair (user:password@host).
    throw new Error(
      "Failed to initialize Postgres adapter — check DATABASE_URL format. " +
        "(Original error scrubbed to avoid leaking credentials.)",
    )
  }
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma

// NOTE: Prisma 7 removed $use() middleware.
// AuditLog immutability is enforced via:
// 1. Database-level trigger (prisma/sql/audit_immutability.sql)
// 2. Application-level guard in auditService (no update/delete methods exposed)
//
// Patient soft-delete filtering is handled in the service layer
// (patientService queries always filter deletedAt: null via the Prisma middleware
// being replaced by explicit where clauses in patient.service.ts).
