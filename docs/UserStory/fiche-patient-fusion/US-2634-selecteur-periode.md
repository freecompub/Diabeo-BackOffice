# US-2634 — Sélecteur de période (1s/2s/1m/3m) synchronisé + `PatientRecordContext`

> 📌 Fiche patient · epic US-2630 · front/back · Taille **M** · dépend de : US-2632

## Contexte
Rendre la période interactive (1 semaine / 2 semaines / 1 mois / 3 mois) et **synchronisée entre onglets**. Casse le RSC pur → introduit une couche de fetch client (amorce RSC 14 j conservée).

## Périmètre
- `PatientRecordContext` : état global `{ period }` (et `view`, cf. US-2636), segments `role=tablist` synchronisés multi-onglets.
- Re-fetch client des panneaux concernés au changement de période, via endpoints **acceptant les deux contrats** : `?patientId=` + `canAccessPatient` (page) **et** `x-consultation-token` (drawer).

## Critères d'acceptation
- **AC-1** Changer la période mets à jour tous les onglets analytiques (période unique pour la fiche).
- **AC-2** **Debounce** des refetch + état de chargement sans flicker.
- **AC-3** **Audit** : la fenêtre lue figure dans `metadata.period`/`window` (un accès 90 j ≠ 7 j en poids forensique) ; pas d'inflation d'`audit_logs` (coalescing autorisé, metadata sans PHI).
- **AC-4** `analyticsService.parsePeriod` accepte 7/14/30/90 j.

## Risques
Refetch storms → debounce. Double contrat endpoints (query + cTok). Couvre archi US-D.
