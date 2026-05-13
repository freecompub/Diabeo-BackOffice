/**
 * @module patient-tag.errors
 * @description Typed error classes for the patient-tag domain. Routes catch
 * via `instanceof` rather than `error.message === "..."` — the latter
 * silently breaks when Prisma wraps an error or a refactor renames the
 * string. Cf. PR #388 review: same anti-pattern fixed with
 * `PopulationTooLargeError`.
 */

export class TagNotFoundError extends Error {
  constructor(public readonly tagId?: number) {
    super("tagNotFound")
    this.name = "TagNotFoundError"
  }
}

/**
 * Either the caller is not a member of the target service, or one of the tag
 * IDs in the input belongs to a service the caller doesn't belong to. We
 * collapse "tag does not exist" and "cross-cabinet tag" into the same
 * error to prevent cross-cabinet ID enumeration.
 */
export class TagForbiddenError extends Error {
  constructor() {
    super("forbidden")
    this.name = "TagForbiddenError"
  }
}

export class TagLabelPiiError extends Error {
  constructor(public readonly reason: string) {
    super("labelLooksLikePii")
    this.name = "TagLabelPiiError"
  }
}

export class MemberNotEligibleError extends Error {
  constructor() {
    super("memberNotEligible")
    this.name = "MemberNotEligibleError"
  }
}

export class ReferentTransferForbiddenError extends Error {
  constructor() {
    super("referentTransferForbidden")
    this.name = "ReferentTransferForbiddenError"
  }
}
