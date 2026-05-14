/**
 * Test suite : mapErrorToResponse
 *
 * Couvre :
 *  - H2 (PR #396 re-review C) : Prisma P2002 (unique conflict) → 409 + target
 *  - Existing H7 : Prisma P2034 (serialization) → 409
 *  - AuthError / ValidationError / NotFoundError standard mappings
 */
import { describe, it, expect } from "vitest"
import { Prisma } from "@prisma/client"
import "../helpers/prisma-mock" // satisfies transitive prisma import via auth
import { mapErrorToResponse } from "@/lib/team-route-helpers"
import { AuthError } from "@/lib/auth"
import {
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"

describe("mapErrorToResponse", () => {
  it("AuthError → status from error", async () => {
    const res = mapErrorToResponse(new AuthError("unauthorized", 401), "test")
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: "unauthorized" })
  })

  it("ValidationError → 422 + field", async () => {
    const res = mapErrorToResponse(new ValidationError("foo"), "test")
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: "validationFailed", field: "foo" })
  })

  it("NotFoundError → 404", async () => {
    const res = mapErrorToResponse(new NotFoundError(), "test")
    expect(res.status).toBe(404)
  })

  it("P2034 serialization conflict → 409 serializationConflict", async () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "tx serialization", { code: "P2034", clientVersion: "7.6.0" },
    )
    const res = mapErrorToResponse(err, "test")
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "serializationConflict" })
  })

  it("H2 — P2002 unique conflict → 409 uniqueConflict + target", async () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "unique violation",
      {
        code: "P2002", clientVersion: "7.6.0",
        meta: { target: ["patient_id", "config_type", "version"] },
      },
    )
    const res = mapErrorToResponse(err, "test")
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe("uniqueConflict")
    expect(body.target).toEqual(["patient_id", "config_type", "version"])
  })

  it("Unknown error → 500", async () => {
    const res = mapErrorToResponse(new Error("boom"), "test")
    expect(res.status).toBe(500)
  })
})
