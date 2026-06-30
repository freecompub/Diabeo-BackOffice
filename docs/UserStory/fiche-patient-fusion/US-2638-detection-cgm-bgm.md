# US-2638 — Détection CGM/BGM + adaptation Vue d'ensemble & Glycémie

> 📌 Fiche patient · epic US-2630 · front/back · Taille **L** · dépend de : US-2631

## Contexte
Introduire la notion first-class **patient sans capteur (BGM)** et adapter les vues : les métriques CGM-only deviennent trompeuses en glycémie capillaire.

## Périmètre
- `dataSource: "cgm" | "bgm"` dérivé de `patientHasCgm` (US-2631).
- Substitutions BGM : **TIR (temps) → % de relevés en cible** · **GMI → HbA1c labo** (`getLastHba1c`) · **courbe continue → nuage de points** · **Données capturées → fréquence (relevés/jour)**. Source BGM = `GlycemiaEntry` (à brancher à l'UI pour la première fois).

## Critères d'acceptation (cliniques — bloquants)
- **AC-1** **Fail-closed** : jamais d'indicateur CGM-only (TIR-temps, GMI, AGP percentiles) pour un patient BGM ; garde `dataSource="bgm"` testée.
- **AC-2** « % de relevés en cible » **explicitement distinct du TIR** + mention du **biais d'échantillonnage** (relevés non répartis uniformément → non comparable au temps ni inter-patient).
- **AC-3** **Aucun GMI/eA1c calculé en BGM** ; seule l'HbA1c **labo** datée est affichée.
- **AC-4** Couleurs/seuils du carnet BGM pathology-aware (US-2631).

## Critères d'acceptation (HDS)
- **AC-5** Lecture BGM via `READ GLYCEMIA_ENTRY` audité, même garde consentement ; le sélecteur CGM/BGM ne crée aucun chemin non audité.

## Notes
Couvre archi US-I + prisma US-FICHE-02/04/06/12. Le plus risqué cliniquement → après stabilisation des vues CGM.
