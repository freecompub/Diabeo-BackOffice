# US-2636 — Vue « Tableau journalier » (1 ligne/jour) + service `dailyStats`

> 📌 Fiche patient · epic US-2630 · front/back · Taille **M** · dépend de : US-2631, US-2634

## Contexte
Sélecteur de **vue** (Moyenne / Tableau journalier), état global synchronisé. Vue « 1 ligne par jour » pour Glycémie/AGP.

## Périmètre
- `analyticsService.dailyStats(patientId, period, source)` : 1 ligne par **jour calendaire Europe/Paris** (moyenne, % en cible, min, max, nb relevés). CGM 90 j → `$queryRaw` `DATE_TRUNC('day', ts AT TIME ZONE 'Europe/Paris')` (perf) ; BGM → `GlycemiaEntry` groupé par jour.
- État `{ view }` dans `PatientRecordContext`, segment `role=tablist`.

## Critères d'acceptation
- **AC-1** % en cible journalier calculé avec les **seuils patient** (pathology-aware).
- **AC-2** Projection serveur (aucun calcul front) ; ≤ 90 lignes triées desc.
- **AC-3** Perf : requête bornée par l'index `[patientId, timestamp]`, pas de fetch-all-in-memory sur 90 j.
- **AC-4** Audit `READ ANALYTICS` `kind="dailyStats"`, `metadata.period`.

## Notes
Couvre archi US-F + prisma US-FICHE-05/10.
