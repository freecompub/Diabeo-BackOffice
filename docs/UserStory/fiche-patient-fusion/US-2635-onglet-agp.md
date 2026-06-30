# US-2635 — Onglet AGP (percentiles) + bandeau stats glucométriques

> 📌 Fiche patient · epic US-2630 · front/back · Taille **M** · dépend de : US-2631, US-2634

## Contexte
Onglet « Profil glycémique » = AGP (médiane + bandes P10–P90 / P25–P75) — back quasi prêt (`analyticsService.agp` + `/api/analytics/agp`). Coût concentré sur la viz + le bandeau de stats.

## Périmètre
- Viz AGP : médiane + percentiles, **bande cible lue depuis les bornes patient** (US-2631).
- Bandeau stats : Moyenne · **GMI** · CV · Écart type (`stdDevMgdl`) · Données capturées.

## Critères d'acceptation
- **AC-1** Le GMI est libellé **« GMI (indicateur de gestion du glucose) »**, **jamais « HbA1c estimée »** ; infobulle « ≠ HbA1c labo, un écart est attendu ».
- **AC-2** Bande/couleurs pathology-aware (GD = 63–140) — test bloquant.
- **AC-3** Suffisance (US-2631) appliquée : 7 j « indicatif », capture < 70 % signalée, slots pauvres sans bande.
- **AC-4** 90 j : mention « peut masquer un ajustement thérapeutique récent ».
- **AC-5** Audit `READ ANALYTICS` `metadata.kind="agp"` (incl. en mode page, équivalent RSC).

## Notes
Viz en tokens (`tokens.ts`). Couvre archi US-E.
