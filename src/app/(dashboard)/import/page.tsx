/**
 * MyDiabby Import — page conteneur (server guard).
 *
 * US-WEB-210 — import réservé aux rôles **≥ DOCTOR** (DOCTOR et ADMIN par
 * hiérarchie), **en miroir** de l'enforcement des routes API
 * `/api/import/mydiabby/*` (`requireRole(req, "DOCTOR")`, min-role). L'UI
 * interactive vit dans `ImportClient` ("use client").
 *
 * Sans ce garde, un NURSE atteignait `/import` par URL directe (la nav la
 * masque seulement) et tombait sur une UI en cul-de-sac (403 à l'action) :
 * défense en profondeur + cohérence avec /admin, /medecin (qui redirigent déjà
 * par rôle). VIEWER est déjà borné par (dashboard)/layout.
 *
 * `hasMinRole` (source unique avec l'API) évite de ré-encoder la liste des
 * rôles : si la hiérarchie évolue, le garde et l'API restent alignés.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import type { Role } from "@prisma/client"
import { hasMinRole } from "@/lib/auth"
import { ImportClient } from "./ImportClient"

export default async function ImportPage() {
  const role = (await headers()).get("x-user-role")
  // ≥ DOCTOR requis. hasMinRole gère un rôle null/inconnu → false → redirect("/")
  // (le routeur racine renvoie vers le home du rôle).
  if (!role || !hasMinRole(role as Role, "DOCTOR")) redirect("/")

  return <ImportClient />
}
