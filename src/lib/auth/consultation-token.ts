/**
 * En-tête HTTP du jeton de consultation éphémère (US-2018b).
 *
 * Module **client-safe volontairement isolé** : il ne contient QUE cette
 * constante et n'importe rien. Consommé côté serveur par `resolveConsultation`
 * (`query-helpers`) qui réexporte cette constante ; le définir ici (plutôt que
 * dans `query-helpers`) évite qu'un éventuel import tire `resolveConsultation` →
 * `consultation.service` → Prisma/Redis dans un bundle navigateur (crash
 * runtime). Le transport `cTok` client est retiré depuis US-2642 ; la
 * décommission serveur (endpoints + branche `cTok`) est suivie dans #622.
 */
export const CONSULTATION_TOKEN_HEADER = "x-consultation-token"
