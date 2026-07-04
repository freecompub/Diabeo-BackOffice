# US-2651 — Algorithme d'ajustement multi-mode

> 📌 Épic US-2645 · back · Taille **L** · dépend de : US-2646, US-2647 · **validation `medical-domain-validator` obligatoire**

## Contexte
`src/lib/proposal-algorithm.ts` est **mono-mode basal-bolus**. Il faut le **router par mode** et couvrir
doses fixes (b) et non-insuliné (c) — **sans jamais franchir la ligne du dosage médicamenteux** (D7).

## Périmètre
- **Router `generateProposals(patient)` par `treatmentMode`** (US-2647).
- **Mode (a)** : conserver l'existant (`analyzeIsfSlot`/`analyzeIcrSlot`/`analyzeBasalTrend`, cap ± 20 %,
  min 3 événements & ≥ 2 %, confiance par volume, bornes dures, `pending`).
- **Mode (b) — nouveau `analyzeFixedDose*`** : base = **tendance glycémique par moment**
  (`BGM_CARNET.MIN_READINGS_PER_MOMENT`, `MEAL_TREND` PPG 2 h). Produit une proposition `fixedDose` bornée :
  cap **absolu** ± 1–2 U ou ± 10 % (le plus petit), plancher/plafond absolu de dose, **cooldown 72 h/moment**.
  **Jamais** : convertir doses fixes → basal-bolus, créer ISF/ICR ex nihilo.
- **Mode (c) — pas de proposition de dose** : produire uniquement des **flags/tâches d'orientation**
  (« à revoir en consultation »), rappels observance/analyses (HbA1c périmée `HBA1C_STALE_DAYS=180`),
  alertes de tendance (TIR < cible). La **cible glycémique** reste ajustable **par le médecin** (bornée
  `TARGET_MIN/MAX_MGDL`, plus stricte en `pregnancyMode`). **Interdiction absolue** de recommander une
  posologie orale/GLP-1 (frontière MDR/IEC 62304).
- **Bornes** : ajouter dans `CLINICAL_BOUNDS` les bornes dose fixe + caps patient (US-2652 les verrouille par test).
- **Grossesse/DG** : désactiver l'auto-proposition ou basculer sur cibles GD (`pregnancyMode`).

## Critères d'acceptation
- **AC-1** L'algorithme choisit sa logique selon le **mode** ; un DT1 n'est jamais traité en (c).
- **AC-2** Mode (b) : proposition de dose fixe **bornée** (cap absolu + cooldown), jamais de refonte de schéma.
- **AC-3** Mode (c) : **aucune** proposition de posologie ; uniquement flags/orientation/cible médecin.
- **AC-4** Toute proposition reste `pending` (jamais auto-appliquée) ; bornes vérifiées à la création.
- **AC-5** Couverture tests unitaires (par mode + cas limites) ≥ 80 %.

## Notes
- Le mode (c) **ne réutilise pas** `AdjustmentProposal` pour porter une dose — objet flag/tâche distinct.
