/**
 * En-tête HTTP du jeton de consultation éphémère (US-2018b).
 *
 * Module **client-safe volontairement isolé** : il ne contient QUE cette
 * constante et n'importe rien. Le client (`useConsultationData`) en a besoin,
 * or l'importer depuis `query-helpers` tirerait `resolveConsultation` →
 * `consultation.service` → Prisma/Redis dans le bundle navigateur (crash
 * runtime). On garde donc le nom d'en-tête ici, sans dépendance serveur.
 */
export const CONSULTATION_TOKEN_HEADER = "x-consultation-token"
