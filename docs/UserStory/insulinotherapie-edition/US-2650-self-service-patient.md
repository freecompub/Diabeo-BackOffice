# US-2650 — Self-service patient : route `(patient)` + nav + lecture + proposer

> 📌 Épic US-2645 · front + back · Taille **L** · dépend de : US-2648, US-2649

## Contexte
Le patient (VIEWER) doit **voir sa thérapie** et **proposer un ajustement** depuis son espace,
accessible via un **item de navigation**. Aujourd'hui : `patientNavItems` = Accueil / Rendez-vous /
Paramètres ; les API `/api/insulin-therapy/*` **bloquent VIEWER** ; `/insulin-therapy` est sous
`(dashboard)` (redirige le VIEWER).

## Périmètre
- **Route patient** `(patient)/patient/insulin-therapy/page.tsx` (layout patient) — rendu **mode-aware**
  (a/b/c) en **lecture** + action « proposer une modification ».
- **Item de nav patient** « Insulinothérapie » ajouté à `patientNavItems` (visible selon mode : masqué/état
  vide informatif pour un patient non insuliné ? — voir AC-4).
- **Endpoint self-service scoped « own »** : nouvel accès **VIEWER → son propre patient** résolu **serveur**
  depuis `user.id` (jamais `?patientId`, anti-énumération). Lecture des settings/doses ; **création de
  proposition** patient (`proposedByRole=PATIENT`) avec **bornes strictes** (cap patient < moteur, sens
  « baisse basal/dose » **interdit**, cooldown, justification obligatoire — cf. épic §6).
- **Acronymes** ISF/ICR explicités (`Acronym` / libellé) — public patient.
- Aucune écriture directe patient ; tout passe par proposition → validation DOCTOR (US-2649).

## Critères d'acceptation
- **AC-1** Le patient voit **sa** thérapie (jamais celle d'un autre ; scope `user.id` serveur).
- **AC-2** Le patient peut **proposer** un ajustement borné → `pending` + notif médecin ; jamais appliqué seul.
- **AC-3** Une proposition patient hors bornes / dans le mauvais sens est **refusée à la saisie** (message clair).
- **AC-4** Mode (c) : le patient voit sa **cible/orientation**, **aucun** champ de dose ni proposition de posologie.
- **AC-5** A11y + i18n (fr/en/ar) + design-system ; aucun id patient en URL.

## Notes
- Réutiliser le composant orphelin `InsulinSummary` (mis en conformité design-system) pour la vue de synthèse.
- L'endpoint `/api/patient/insulin-settings` existant (lecture) est à **re-scoper own-id** ou remplacer.

## Révision post-revue (HDS + archi) — voir épic §12
- **Own-id strict** : résolution **exclusive** `getOwnPatientId(user.id)` ; **aucun** `?patientId`, **aucun** `x-consultation-token` sur les routes patient ; Zod **sans** `patientId`. Re-scoper `/api/patient/insulin-settings` (§12 « à intégrer », HIGH IDOR). Test VIEWER visant un autre id/token → son dossier.
- Justification patient → champ **`proposerComment`** chiffré (pas `Ack.comment`) (§12).
- `InsulinSummary` : vérifier **absence de fuite import client/serveur** avant montage `(patient)` (§12 nit).
