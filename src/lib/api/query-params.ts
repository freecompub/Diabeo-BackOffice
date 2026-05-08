/**
 * @module lib/api/query-params
 * @description Helpers partagés pour parser les query params dans les routes API.
 *
 * Centralise les patterns dupliqués (parseEnumList, parseId, intSchema)
 * identifiés en review (PR #350 M1/M3 code).
 */

import { z } from "zod"

/**
 * Schéma Zod commun pour un id positif optionnel — réutilisé dans toutes les
 * routes admin qui prennent `?limit=`, `?cursor=`, `?patientId=`.
 */
export const positiveIntSchema = z.coerce.number().int().positive().optional()

/**
 * Result discriminé pour parseEnumList — distingue "absent" (`ok: true,
 * value: undefined`) de "invalid input" (`ok: false`).
 */
export type EnumListResult<T> =
  | { ok: true; value: T[] | undefined }
  | { ok: false }

/**
 * Parse un query param de type `?status=open,acknowledged` contre un Zod enum.
 * Retourne `{ ok: false }` si une valeur n'est pas dans l'enum (la route doit
 * répondre 400). `value: undefined` quand le param est absent.
 */
export function parseEnumList<T extends string>(
  value: string | null,
  schema: z.ZodType<T>,
): EnumListResult<T> {
  if (!value) return { ok: true, value: undefined }
  const arr = value.split(",").map((v) => v.trim()).filter(Boolean)
  if (arr.length === 0) return { ok: true, value: undefined }
  const parsed = z.array(schema).safeParse(arr)
  if (!parsed.success) return { ok: false }
  return { ok: true, value: parsed.data }
}

/**
 * Parse un id de route param (`/users/[id]`). Retourne `null` si invalide
 * (la route doit alors répondre 400 invalidId).
 */
export function parseRouteId(raw: string): number | null {
  const id = Number.parseInt(raw, 10)
  return Number.isInteger(id) && id > 0 ? id : null
}
