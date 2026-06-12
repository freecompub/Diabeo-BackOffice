# Terminologie GMI vs « HbA1c estimée » (eHbA1c) — suivi clinique

> **Statut** : backlog clinique (MEDIUM). Identifié en revue PR #534 (round 2) par
> le `medical-domain-validator`. **Pré-existant** — non introduit par la PR.

## Problème

La **même valeur calculée** par `glucoseManagementIndicator(avgMgdl) = 3.31 + 0.02392·avgMgdl`
(`src/lib/statistics.ts`) est affichée sous **deux libellés cliniquement distincts**
selon la vue :

| Vue | Libellé affiché | Source |
|-----|-----------------|--------|
| Détail patient (pro) | « Indicateur de gestion du glucose (GMI) » | `patient.gmi` |
| Dashboard patient + widgets (`HbA1cWidget`, `DataSummaryGrid`) | « HbA1c estimée » / « Estimated HbA1c (eHbA1c) » | `profile.metrics.gmi` |

## Enjeu clinique

Le terme **GMI** (Glucose Management Indicator, ADA / Battelino *Diabetes Care* 2019) a
**délibérément remplacé** l'ancienne « HbA1c estimée / eA1c » : appeler un index dérivé
du CGM « HbA1c estimée » induit en erreur, car GMI et HbA1c **de laboratoire** divergent
fréquemment de ≥ 0,3–0,5 % chez un même individu (durée de vie des hématies, taux de
glycation, anémie, grossesse). Présenter la même valeur sous deux noms peut laisser
croire à **deux mesures indépendantes** alors qu'il s'agit du **même calcul**.

## Correction immédiate (PR #534)

La carte du **dashboard patient** qui affirmait « Hémoglobine glyquée (HbA1c) estimée »
sur une valeur GMI a été relabellée **« Indicateur de gestion du glucose (GMI) »**
(`src/app/(patient)/patient/dashboard/page.tsx`) — alignée sur le calcul réel et la vue pro.

## Décision transverse à arbitrer (hors PR #534)

Les autres surfaces patient (`HbA1cWidget`, `DataSummaryGrid`, namespace i18n
`education.hba1c`, `GlycemicProfileTab` qui mappe explicitement `gmi → hba1c` avec le
commentaire « GMI = équivalent moderne de l'HbA1c estimée ») utilisent encore le cadrage
« HbA1c estimée (eHbA1c) » — avec le disclaimer « valeur estimée, pas un résultat de
laboratoire ». **Unifier toute l'app sur la terminologie GMI** (recommandation ADA) est
une **décision produit + clinique** à valider avant exécution :

1. Soit **tout migrer vers « GMI »** (cohérent avec ADA et la vue pro).
2. Soit **conserver « HbA1c estimée »** côté patient (familiarité) **à condition** que
   chaque occurrence précise explicitement qu'il s'agit du GMI (CGM-dérivé) et qu'il
   peut différer d'une HbA1c de laboratoire.

Aucune dose d'insuline ne dépend de ce libellé (valeur calculée correctement) → non bloquant.
