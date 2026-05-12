/**
 * Guard that ensures a route/service runs only outside production.
 *
 * Allowed when :
 *  - `APP_ENV === "staging"` (recette / pré-prod sur VPS dédié)
 *  - `NODE_ENV === "development"` AND `DIABEO_ALLOW_LOCAL_MYDIABBY === "1"`
 *    (dev local, opt-in explicite — H4 fix)
 *
 * Bloqué (404) sinon — typiquement :
 *  - prod (`NODE_ENV === "production"` sans `APP_ENV=staging`)
 *  - test (NODE_ENV=test, fixtures contrôlées sans APIs externes)
 *  - dev local sans opt-in (évite qu'un dev étourdi connecte son compte
 *    MyDiabby personnel sur localhost et importe ses propres PHI dans
 *    une DB dev non-chiffrée at-rest — RGPD Art. 9)
 *
 * **Pour activer en dev** : `DIABEO_ALLOW_LOCAL_MYDIABBY=1 pnpm dev`
 * (et utiliser un compte MyDiabby sandbox/test, jamais réel).
 *
 * Le nom historique `isStagingEnv` est conservé pour ne pas casser les 4
 * routes consommatrices ; sémantiquement c'est désormais "is non-production
 * env with explicit MyDiabby opt-in".
 */

import { NextResponse } from "next/server"

export function isStagingEnv(): boolean {
  if (process.env.APP_ENV === "staging") return true
  // En dev local, NODE_ENV est "development" par défaut (Next.js dev server).
  // Production force NODE_ENV = "production" via `next start` → gate fermée.
  // H4 — opt-in explicite requis pour le dev local (évite import accidentel
  // de PHI réelles dans une DB dev non auditée).
  if (process.env.NODE_ENV === "development") {
    return process.env.DIABEO_ALLOW_LOCAL_MYDIABBY === "1"
  }
  return false
}

export function stagingOnlyResponse(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}
