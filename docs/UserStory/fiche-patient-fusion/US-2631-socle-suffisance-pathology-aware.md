# US-2631 — Socle données : suffisance + cibles pathology-aware + helpers backend

> 📌 Fiche patient · **PRÉREQUIS** de l'epic US-2630 · back · Taille **M**

## Contexte
Aucune vue analytics ne doit être livrée sans (a) cibles adaptées à la pathologie et (b) un plancher de suffisance de données. Ce socle, posé **en premier**, est consommé par toutes les US suivantes (sinon risque patient : faux rassurement GD + percentiles/pics artefactuels). Regroupe aussi les helpers backend manquants (aucune migration).

## Périmètre
- **Helper cibles patient** unique, lu par toutes les vues : bornes via `getCgmDefaults(pathology)` / objectif CGM patient (`getPatientThresholds`), exposé au DTO de rendu (bande, légende, couleurs).
- **Suffisance AGP** : étendre `computeAgp` — minimum de relevés par slot (ex. ≥ 3) avant de tracer P10/P90 ; propager `warning insufficientCgmCapture` (< 70 %) ; fenêtre 7 j marquée « indicatif (< 14 j) ».
- `analyticsService.glycemicProfile()` : **exposer `stdDevMgdl`** (`stddev` déjà calculé en interne).
- `patientHasCgm(patientId)` : `PatientDevice` (cgm, non révoqué, capteur non expiré) ; fallback `CgmEntry` récents (< 14 j).
- `glycemia.getLastHba1c(patientId)` : `findFirst(GlycemiaEntry, hba1c not null, orderBy date desc)` → `{ value, date }`.
- `analyticsService.bgmStats(patientId, period)` : % `GlycemiaEntry` en cible (≠ TIR) + fréquence relevés/jour, via seuils patient.

## Critères d'acceptation
- **AC-1** Un patient `pathology = GD` obtient des bornes **63–140 mg/dL** dans le DTO ; un DT1/DT2 obtient 70–180. (test bloquant)
- **AC-2** AGP 7 j : percentiles externes masqués/grisés + label « indicatif » ; capture < 70 % → `warning` présent dans la réponse.
- **AC-3** Un slot AGP sous le minimum de relevés → médiane seule (ou trou), jamais une bande.
- **AC-4** `stdDevMgdl`, `patientHasCgm`, `getLastHba1c`, `bgmStats` exposés, scopés + audités (`READ` dédié, metadata sans PHI).
- **AC-5** Aucune migration Prisma.

## Risques / notes
Source de vérité des bornes = `getCgmDefaults` (déjà pathology-aware). Ne pas dupliquer de constantes 70–180. Couvre prisma US-FICHE-01/02/03/04 + le socle clinique « data-sufficiency & pathology-aware ».
