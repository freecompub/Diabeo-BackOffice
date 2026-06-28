/**
 * MyDiabby Import — page conteneur (server guard).
 *
 * US-WEB-210 — import réservé aux rôles **≥ DOCTOR** (DOCTOR et ADMIN par
 * hiérarchie), **en miroir** de l'enforcement des routes API
 * `/api/import/mydiabby/*` (`requireRole(req, "DOCTOR")`, min-role). L'UI
 * interactive vit dans `ImportClient` ("use client").
 *
 * ⚠️ Feature **recette/staging uniquement** : les 4 routes API et le service
 * (`mydiabby-sync` / `mydiabby-client`) sont doublement gardés serveur
 * (`isStagingEnv()` → `stagingOnlyResponse()` ; `APP_ENV !== "staging"` →
 * `throw`). En production la feature est inerte (403 stagingOnly), donc l'accès
 * ADMIN (admis par la hiérarchie min-role) **n'importe aucun PHI patient en
 * prod** — pas de conflit avec le positionnement « ADMIN no-PHI ». Ce garde est
 * purement de la défense en profondeur + cohérence UX pour la recette.
 *
 * Sans lui, un NURSE atteignait `/import` par URL directe (la nav la masque
 * seulement) et tombait sur une UI en cul-de-sac (403 à l'action). VIEWER est
 * déjà borné par (dashboard)/layout.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { hasMinRole } from "@/lib/auth"
import { isKnownRoleString } from "@/lib/auth/role-home"
import { ImportClient } from "./ImportClient"

export default async function ImportPage() {
  const role = (await headers()).get("x-user-role")
  // ≥ DOCTOR requis. `isKnownRoleString` rejette null/rôle inconnu (fail-closed,
  // sans cast) avant le check de hiérarchie. Le routeur racine renvoie vers le
  // home du rôle.
  if (!isKnownRoleString(role) || !hasMinRole(role, "DOCTOR")) redirect("/")

  return <ImportClient />
}
