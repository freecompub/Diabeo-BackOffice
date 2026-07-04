# US-2647 — Détection du mode de traitement (a/b/c) + gating fail-closed

> 📌 Épic US-2645 · back · Taille **S/M** · dépend de : US-2646

## Contexte
Toute la feature s'adapte au mode : basal-bolus (a), doses fixes (b), non insuliné (c).
La détection doit être **fiable** et **fail-closed** (en cas d'ambiguïté, ne PAS activer d'édition
insuline ni d'ajustement de dose).

## Périmètre
- Service `treatmentModeService.resolve(patientId)` → `basalBolus | fixedDose | nonInsulin`.
  - **(a)** si `InsulinTherapySettings` présent avec `sensitivityFactors[]` **et** `carbRatios[]` non vides.
  - **(b)** si insuline active (`PatientInsulin` bolus/basal/both **ou** `BasalConfiguration.configType ∈ {single_injection, split_injection}`) **sans** ratios complets.
  - **(c)** si **aucune** insuline active ni settings (éventuel `Treatment.type=glp1`/ADO/diététique).
- Router par **`pathology`** en garde-fou : un **DT1 n'est jamais classé (c)** (fail-closed → au moins mode b).
- Bloquer l'édition/proposition si la config est **incohérente** (`hasGap`/`hasOverlap`/`bolusInconsistent`
  déjà calculés par `buildTreatmentView`) → « corriger la couverture 24 h d'abord ».
- Persister le résultat dans `Patient.treatmentMode` (US-2646) + recalcul à chaque changement de traitement.

## Critères d'acceptation
- **AC-1** Chaque patient est classé dans un mode déterministe ; DT1 jamais en (c).
- **AC-2** Config incohérente → mode connu mais **édition/proposition bloquée** avec message explicite.
- **AC-3** Le mode gouverne l'UI (US-2648/2650) et l'algorithme (US-2651) ; fail-closed en cas de doute.

## Notes
- Les patients oraux/GLP-1 (module médicaments, Phase 10) relèvent du mode (c).
