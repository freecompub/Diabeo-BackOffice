/**
 * @route GET /api/config/tax-rules/active
 * @description US-2110 — Résolution du taux fiscal actif pour
 * `(countryCode, taxType)` à une date donnée (default = now).
 *
 * Cas d'usage :
 *   - UI cabinet : afficher le taux actuel pour la création de facture.
 *   - Compta : back-fill / audit d'une facture rétro-datée.
 *
 * Auth : NURSE+ (lecture seule, info publique au cabinet).
 * Audit : `COUNTRY_TAX_RULE/READ` avec metadata `kind: "tax_rule.active"`.
 *
 * Query params :
 *   - `countryCode` (required) — ISO 3166-1 alpha-2 (FR, DZ, ...).
 *   - `taxType` (required) — VAT | INCOME_TAX | CORPORATE_TAX | SOCIAL_CONTRIBUTION.
 *   - `date` (optional) — ISO date, defaults to today.
 */
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { AuthError } from "@/lib/auth"
import { countryTaxRuleService } from "@/lib/services/country-config.service"
import { auditService, extractRequestContext } from "@/lib/services/audit.service"
import { auditedRequireRole, mapErrorToResponse } from "@/lib/team-route-helpers"

const TAX_TYPES = ["VAT", "INCOME_TAX", "CORPORATE_TAX", "SOCIAL_CONTRIBUTION"] as const

const querySchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  taxType: z.enum(TAX_TYPES),
  date: z.coerce.date().optional(),
})

export async function GET(req: NextRequest) {
  const ctx = extractRequestContext(req)
  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    )
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validationFailed", details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const user = await auditedRequireRole(
      req, "NURSE", ctx, "COUNTRY_TAX_RULE", "active",
    )
    const atDate = parsed.data.date ?? new Date()
    const rule = await countryTaxRuleService.getActiveAt(
      parsed.data.countryCode, parsed.data.taxType, atDate,
    )
    // Audit READ — pas de PHI, mais traçabilité Compta.
    await auditService.log({
      userId: user.id,
      action: "READ",
      resource: "COUNTRY_TAX_RULE",
      resourceId: "active",
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      requestId: ctx.requestId,
      metadata: {
        kind: "tax_rule.active",
        countryCode: parsed.data.countryCode,
        taxType: parsed.data.taxType,
        atDate: atDate.toISOString().slice(0, 10),
        found: rule !== null,
      },
    })
    if (!rule) {
      return NextResponse.json(
        {
          error: "noActiveRule",
          countryCode: parsed.data.countryCode,
          taxType: parsed.data.taxType,
          // L7 review round 1 — atDate inclus pour replay forensique.
          atDate: atDate.toISOString().slice(0, 10),
        },
        { status: 404 },
      )
    }
    return NextResponse.json({ rule })
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    return mapErrorToResponse(e, "config/tax-rules/active GET", ctx.requestId)
  }
}
