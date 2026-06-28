/**
 * MyDiabby Import — page conteneur (server guard).
 *
 * US-WEB-210 — fonctionnalité d'import **réservée au médecin** (et ADMIN, par
 * hiérarchie de rôle). Le contenu interactif vit dans `ImportClient` ("use
 * client").
 *
 * Garde serveur : mire l'enforcement des routes API d'import
 * (`/api/import/mydiabby/*` → `requireRole(req, "DOCTOR")`, min-role → DOCTOR
 * et ADMIN). Sans ce garde, un NURSE atteignait `/import` par URL directe
 * (la nav la masque seulement) et tombait sur une UI en cul-de-sac (403 à
 * l'action). Défense en profondeur + cohérence avec les pages /admin, /medecin
 * qui redirigent déjà par rôle. VIEWER est déjà borné par (dashboard)/layout.
 */

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { ImportClient } from "./ImportClient"

const ALLOWED_ROLES = new Set(["DOCTOR", "ADMIN"])

export default async function ImportPage() {
  const role = (await headers()).get("x-user-role")
  // Non-DOCTOR/ADMIN (ex. NURSE) → bounce vers `/`, le routeur de rôle racine
  // renvoie vers le home du rôle (cohérent avec admin/page.tsx).
  if (!role || !ALLOWED_ROLES.has(role)) redirect("/")

  return <ImportClient />
}
