/**
 * @module review-constants
 * @description US-2605 — Constantes partagées du mode revue de consultation.
 *
 * `REVIEW_PERIOD` est la fenêtre d'agrégation du Résumé glycémique (cohérente
 * avec le dossier patient, `OVERVIEW_PERIOD`). Elle sert aussi d'**ancrage**
 * (`period`) figé sur le compte rendu finalisé. Source unique : la page de revue
 * (affichage) ET la route de finalisation (valeur serveur-autoritaire) l'importent.
 */

/** Fenêtre du Résumé glycémique (bornée < 90j par `analyticsService`). */
export const REVIEW_PERIOD = "14d"

/** Nombre de jours dérivé de `REVIEW_PERIOD`, pour l'affichage i18n. */
export const REVIEW_PERIOD_DAYS = Number.parseInt(REVIEW_PERIOD, 10)

/**
 * Seuil (%) au-delà duquel une variation de proposition d'ajustement est mise en
 * exergue (badge « destructive »). Aligné sur le clamp ±20 % de l'algorithme de
 * génération (`proposal-algorithm.ts`) : 20 % = pas de titration maximal proposé.
 * Indice visuel pur — aucune action clinique déclenchée. Source unique pour la
 * traçabilité (doc clinical-logic).
 */
export const PROPOSAL_MAJOR_CHANGE_PCT = 20
