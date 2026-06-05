import "dotenv/config"
import { createBdd } from "playwright-bdd"
import { world } from "./world"

const { Before } = createBdd()

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""])

/**
 * Hook exécuté avant chaque scénario :
 *  1. **Garde anti-prod** — ces tests CRÉENT/LISENT des données patient. On refuse
 *     toute `DATABASE_URL` non-locale → jamais de faux patients créés en
 *     staging/prod (sécurité, reco healthcare-security-auditor).
 *  2. **Reset de l'état partagé** (`world`) entre scénarios — évite qu'un scénario
 *     lise la réponse/email d'un précédent (reco code-reviewer).
 */
Before(async () => {
  const url = process.env.DATABASE_URL ?? ""
  let host = ""
  try {
    host = new URL(url).hostname
  } catch {
    host = ""
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `BDD refusé : DATABASE_URL non-local (host="${host}"). ` +
        `Ce harness manuel ne doit tourner que sur une base de dev locale.`,
    )
  }

  world.status = 0
  world.body = null
  world.createdEmail = ""
  world.createdAppointmentId = 0
})
