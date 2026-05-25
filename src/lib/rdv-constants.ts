/**
 * Constantes partagées RDV — single source of truth client+serveur.
 *
 * Fix CR-5 round 1 review PR #436 — `PROPOSAL_TTL_MS` était dupliqué dans :
 *   - `src/lib/services/rdv.service.ts:44` (backend gate via 422 alternativeExpired)
 *   - `src/components/diabeo/appointments/AlternativesBanner.tsx` (count UI)
 *
 * Risque drift : si la décision business passe à 14j côté backend, l'UI
 * compterait des alternatives expirées comme actives → faux positifs bandeau.
 *
 * Extraction dans ce module commun pour garantir que les 2 côtés évoluent
 * ensemble. Pas de dépendance Prisma/Next → safe import client + serveur.
 */

/**
 * Durée TTL d'une alternative proposée par DOCTOR.
 * Au-delà, le backend refuse `acceptAlternative` avec code `alternativeExpired`.
 *
 * Si modification : impact UX patient (mobile) + secrétariat (backoffice).
 * À discuter business avant changement.
 */
export const PROPOSAL_TTL_MS = 7 * 86_400_000 // 7 jours
