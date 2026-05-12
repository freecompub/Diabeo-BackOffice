/**
 * Guard that ensures a route/service runs only outside production.
 *
 * Allowed when :
 *  - `APP_ENV === "staging"` (recette / pré-prod sur VPS dédié)
 *  - `NODE_ENV === "development"` (dev local `pnpm dev`)
 *
 * Bloqué (404) sinon — typiquement en prod (`NODE_ENV === "production"`
 * sans `APP_ENV=staging`) ou en test (où on monte des fixtures contrôlées
 * sans dépendre d'APIs externes comme MyDiabby).
 *
 * Le nom historique `isStagingEnv` est conservé pour ne pas casser les 4
 * routes consommatrices ; sémantiquement c'est désormais "is non-production
 * env" — d'où l'élargissement au dev local pour qu'un développeur puisse
 * tester la sync MyDiabby localement.
 */

import { NextResponse } from "next/server"

export function isStagingEnv(): boolean {
  if (process.env.APP_ENV === "staging") return true
  // En dev local, NODE_ENV est "development" par défaut (Next.js dev server).
  // Production force NODE_ENV = "production" via `next start` → gate fermée.
  return process.env.NODE_ENV === "development"
}

export function stagingOnlyResponse(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}
