# US-2637 — Onglet Tendances de repas (mini-courbes alignées + journal repas)

> 📌 Fiche patient · epic US-2630 · front/back · Taille **L** · dépend de : US-2631, US-2636

## Contexte
Onglet « Tendances de repas » façon LibreView : **4 mini-courbes par moment** (Nuit/Matin/Midi/Soir) alignées sur l'heure du repas (−1 h→+3 h, pic post-prandial) + **journal repas** (1 jour/ligne, Matin/Midi/Soir × **Avant · Après · Repas[glucides] · Bolus**). Le morceau le plus sensible (clinique **et** HDS).

## Périmètre
- `mealtimePattern.alignedCurve(patientId, period)` : par moment, série CGM alignée t=0 par tranches 15 min [−60, +180] + **pic** + avant/après moyens.
- `mealtimePattern.dailyJournal(patientId, period)` : jour × moment × (avant=`glycemiaValue`, après=lookup CGM/BGM post-repas, glucides=`carbohydrates`, bolus=`bolusDose`).
- Source : `DiabetesEvent` (`eventTypes has insulinMeal`) + `CgmEntry`/`GlycemiaEntry` ; moments depuis `UserDayMoment` du patient (defaults Nuit 22–04 / Matin 04–10 / Midi 10–16 / Soir 16–22).

## Critères d'acceptation (cliniques — bloquants)
- **AC-1** Définitions formelles : **pré** = dernier relevé [−30 min, repas] ; **excursion** = max sur (repas, repas + **min(3 h, prochain repas)**] ; **après** = règle CGM datée (à valider `medical-domain-validator`).
- **AC-2** **Minimum de repas appariés** par créneau (≥ 3 avec pré ET post) sinon « données insuffisantes » ; en BGM, pas d'interpolation (pic affiché seulement si relevé post réel).
- **AC-3** Seuils d'excursion **pathology-aware** (cible absolue post-prandiale GD distincte) ; libellé **non prescriptif** (« excursion élevée — à corréler ICR / timing bolus / repas », pas « → ajuster l'ICR »).
- **AC-4** Les moments dérivent de la config `dayMoment` du patient et **désignent le slot ISF/ICR exact** ; toute proposition d'ajustement passe par `AdjustmentProposal (pending) → review DOCTOR`.

## Critères d'acceptation (HDS — bloquants)
- **AC-5** Lecture `DiabetesEvent` via service **scopé + audité** (`READ DIABETES_EVENT`, `metadata.patientId` pivot, `period`) ; **aucune valeur clinique dans `metadata`**.
- **AC-6** **Texte libre repas** (`comment`/`mealDescription`) : **chiffré AES-256-GCM OU non exposé** (décision DPIA) — non livrable sinon.
- **AC-7** **Lazy-load** : données repas absentes du payload/DOM tant que l'onglet n'est pas ouvert.

## Notes
Couvre archi US-G+H + prisma US-FICHE-07/08/11. Revue `medical-domain-validator` requise avant implémentation.
