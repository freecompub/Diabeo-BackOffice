/**
 * @module team-workflow.errors
 * @description Typed errors for the Groupe 3 team-workflow domain (10 US).
 * Same pattern as `patient-tag.errors.ts` — routes use `instanceof` to map
 * to HTTP status instead of fragile `error.message === "..."` strings.
 */

export class ValidationError extends Error {
  constructor(public readonly field: string) {
    super("validationFailed")
    this.name = "ValidationError"
  }
}

export class NotFoundError extends Error {
  constructor() {
    super("notFound")
    this.name = "NotFoundError"
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("forbidden")
    this.name = "ForbiddenError"
  }
}
