/**
 * Helper `isUniqueViolationOn` — reconnaissance d'un P2002 ciblé sur une contrainte, robuste aux DEUX
 * formes d'erreur Prisma : legacy (`meta.target`) ET Prisma 7 + `@prisma/adapter-pg`
 * (`meta.driverAdapterError.cause`, `meta.target` étant `undefined`). Risque : sans ce helper, le mapping
 * legacy ne matche jamais en prod → P2002 brut au lieu de l'erreur métier.
 */
import { describe, it, expect } from "vitest"
import { isUniqueViolationOn } from "@/lib/db/prisma-errors"

describe("isUniqueViolationOn", () => {
  it("forme Prisma 7 + adapter-pg (meta.target undefined, nom dans driverAdapterError.cause) → match", () => {
    const err = {
      code: "P2002",
      meta: {
        driverAdapterError: {
          cause: {
            originalMessage: 'duplicate key value violates unique constraint "slot_set_proposals_one_pending_per_param_origin"',
            constraint: { fields: ["patient_id", "parameter_type"] },
          },
        },
      },
    }
    expect(isUniqueViolationOn(err, "one_pending")).toBe(true)
  })

  it("forme legacy (meta.target = string[]) → match (fallback conservé)", () => {
    const err = { code: "P2002", meta: { target: ["adjustment_proposals_one_pending_per_slot"] } }
    expect(isUniqueViolationOn(err, "one_pending")).toBe(true)
  })

  it("P2002 sur une AUTRE contrainte → pas de match (ne masque pas un conflit sans rapport)", () => {
    const err = {
      code: "P2002",
      meta: { driverAdapterError: { cause: { originalMessage: 'duplicate key ... "users_email_hmac_key"' } } },
    }
    expect(isUniqueViolationOn(err, "one_pending")).toBe(false)
  })

  it("code non-P2002 → false", () => {
    expect(isUniqueViolationOn({ code: "P2025", meta: { target: ["one_pending"] } }, "one_pending")).toBe(false)
  })

  it("erreur non-Prisma / undefined → false (pas de throw)", () => {
    expect(isUniqueViolationOn(new Error("boom"), "one_pending")).toBe(false)
    expect(isUniqueViolationOn(undefined, "one_pending")).toBe(false)
    expect(isUniqueViolationOn(null, "one_pending")).toBe(false)
  })
})
