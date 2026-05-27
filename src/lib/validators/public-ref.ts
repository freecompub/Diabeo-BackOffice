/**
 * Validateur Zod pour `publicRef` UUID v4 (US-2076bis-V2 Issue #442).
 *
 * Fix L1 round 1 review PR #455 — réutilisable pour tout futur endpoint
 * acceptant `publicRef` en input (ex: `GET /api/patients/by-ref/:publicRef`
 * mobile iter 3, `POST /api/messages { toUserPublicRef }` Issue #456 V2).
 *
 * Format RFC 4122 v4 : 8-4-4-4-12 hex avec version digit `4` au bit 13 et
 * variant digit `8/9/a/b` au bit 17. Zod `z.string().uuid()` valide tous
 * les UUIDs v1-v5 — on rest strict v4 pour notre cas.
 *
 * **Pattern défensif** : si un futur endpoint accepte `publicRef` URL param,
 * il DOIT :
 *   1. Valider avec ce schema (rejette 400 si format invalide)
 *   2. Lookup en temps constant via UNIQUE B-tree index (déjà créé migration)
 *   3. Audit `accessDenied` US-2265 sur lookup invalide (anti-énumération)
 *   4. Rate-limit pour empêcher brute-force inverse 122 bits (hygiène)
 *
 * Cf. `docs/runbook/messaging-mobile-contract.md` pour le contrat complet.
 */

import { z } from "zod"

/**
 * Schema strict UUID v4 (RFC 4122). Accepte string lowercase ou uppercase.
 */
export const publicRefSchema = z
  .string()
  .uuid("Invalid UUID format (expected RFC 4122 v4)")
  .refine(
    (value) => {
      // Version digit `4` au bit 13 (char index 14 — séparateurs inclus).
      const versionChar = value[14]
      // Variant digit `8/9/a/b` au bit 17 (char index 19).
      const variantChar = value[19]
      return versionChar === "4" && /^[89ab]$/i.test(variantChar ?? "")
    },
    "Must be UUID v4 (version=4, variant=8/9/a/b)",
  )

/**
 * Type branded pour `publicRef` (anti-confusion avec autres UUIDs / strings).
 * Garantie au compile-time que la string a passé `publicRefSchema.parse()`.
 */
export type PublicRef = string & { readonly __brand: "PublicRef" }
