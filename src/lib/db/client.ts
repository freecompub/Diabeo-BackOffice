import { PrismaClient } from "@prisma/client"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma

// NOTE: Prisma 7 removed $use() middleware.
// AuditLog immutability is enforced via:
// 1. Database-level trigger (prisma/sql/audit_immutability.sql)
// 2. Application-level guard in auditService (no update/delete methods exposed)
//
// Patient soft-delete filtering is handled in the service layer
// (patientService queries always filter deletedAt: null via the Prisma middleware
// being replaced by explicit where clauses in patient.service.ts).
