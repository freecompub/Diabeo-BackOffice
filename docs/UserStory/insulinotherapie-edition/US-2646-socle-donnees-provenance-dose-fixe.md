# US-2646 — Socle données : provenance de proposition + dose fixe structurée + enum + `treatmentMode`

> 📌 Épic US-2645 · back · **migration Prisma** · Taille **M** · dépend de : —

## Contexte
Le flux « patient/infirmier propose » et le mode « doses fixes » ne sont pas modélisables :
`AdjustmentProposal` n'a pas de provenance, `AdjustableParameter` ne connaît que ISF/ICR/basal,
et `PatientInsulin.dosage` est du texte libre non calculable.

## Périmètre
- **`AdjustmentProposal`** : ajouter `proposedByRole` (`PATIENT|NURSE|DOCTOR`) + `proposedByUserId`
  (FK `User`) — obligatoires (défaut de non-répudiation HDS sinon). Conserver `reviewedBy`/`reviewedAt`.
- **`enum AdjustableParameter`** : ajouter `fixedDose` (et, si retenu, `glucoseTarget`). Toute nouvelle
  valeur **doit** venir avec sa borne dans `CLINICAL_BOUNDS` (US-2652) — garde-fou `validateProposedValue`.
- **Dose fixe structurée** : introduire une représentation **numérique par moment** (matin/midi/soir/nuit)
  — soit exploiter `BasalConfiguration.morningDose/eveningDose/dailyDose` (déjà numériques) comme source
  de vérité, soit une table `FixedDoseSlot` (moment, valeur U, insuline). `PatientInsulin.dosage` texte
  libre reste **affichage**, jamais base de calcul.
- **`Patient.treatmentMode`** (enum `basalBolus|fixedDose|nonInsulin`) — dérivable mais explicite =
  plus sûr/auditable ; renseigné par la détection (US-2647), défaut fail-closed.
- Migration versionnée (US-2267) — **non destructive**, `db push` interdit en prod, CI drift gate.

## Critères d'acceptation
- **AC-1** Une `AdjustmentProposal` porte toujours `proposedByRole` + `proposedByUserId` (NOT NULL).
- **AC-2** `AdjustableParameter` étendu ; aucun type sans borne clinique associée (test).
- **AC-3** Une dose fixe est lisible **numériquement** par moment (base d'un futur ajustement).
- **AC-4** Migration réversible, drift check vert, seed mis à jour.

## Notes
- Valider avec `prisma-specialist` + `architect-reviewer` (réutiliser `AdjustmentProposal` vs objet dédié
  pour le mode non-insuliné — cf. US-2651, le mode (c) ne porte **pas** de posologie).
- Alignement iOS si le modèle bouge (`swift-expert`).
