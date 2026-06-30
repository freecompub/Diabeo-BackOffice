# US-2639 — BGM : AGP→Carnet + carnet repas + HbA1c labo

> 📌 Fiche patient · epic US-2630 · front/back · Taille **M** · dépend de : US-2635, US-2637, US-2638

## Contexte
Compléter le mode BGM des onglets analytiques : sans capteur, l'AGP n'est pas calculable et les tendances de repas se font sur relevés capillaires.

## Périmètre
- Onglet « Profil glycémique » en BGM → **Carnet** (moyenne par moment de la journée), via `bgmDailyPatternByMoment` (14 j/90 j calculés dynamiquement — `AverageData` iOS insuffisant).
- Tendances de repas en BGM → carnet capillaire avant/après (pas de courbe interpolée).

## Critères d'acceptation
- **AC-1** Terminologie : « carnet » et non « AGP » en BGM ; jamais « TIR »/« temps dans la cible ».
- **AC-2** Pic/variation affichés uniquement si relevés post réels (pas d'interpolation).
- **AC-3** Plancher : < N relevés/jour ou < M jours → « données insuffisantes ».
- **AC-4** Couleurs pathology-aware (US-2631).

## Notes
Ne PAS toucher l'enum `PeriodType` d'`AverageData` (cache iOS V1 — coordination dépôt iOS). Couvre archi US-J + prisma US-FICHE-03/06.
