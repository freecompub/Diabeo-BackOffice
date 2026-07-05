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

## Reports de la revue code+migration (PR #638 / US-2646) — à fermer ici
- **Chiffrement `proposer_comment`** (**CRITIQUE dès la 1ʳᵉ écriture patient**) : la justification patient (texte libre) est un `TEXT` en clair au socle → `encrypt()` AES-256-GCM à l'écriture, `decrypt()` en lecture autorisée uniquement ; **jamais** en clair (log/notif/URL). Test asserttant le format ciphertext (IV‖TAG‖CT base64). *(HDS)*

---
## Journal d'implémentation

### Slice 1 — endpoint lecture own-id strict (back, sécurité)
- `GET /api/patient/insulin-settings` **re-scopé own-id STRICT** : résolution exclusive
  `getOwnPatientId(user.id)` — **plus** de `resolvePatientIdFromQuery` (donc plus de `?patientId`
  ni de `x-consultation-token`). Ferme le HIGH IDOR §12 (AC-1). Endpoint sans caller (orphelin
  US-2018b) → re-scope sûr. Un pro (pas de dossier patient) → `getOwnPatientId` null → 404 neutre ;
  le workspace pro lit l'insuline via la fiche `/patients/[id]`.
- Tests : +4 (own-id + audit, **anti-IDOR `?patientId` ignoré**, non-patient → 404, RGPD → 403).
- **`proposerComment` déjà chiffré** (AES-256-GCM, `encryptField`) + omis des réponses `list` →
  le CRITICAL « chiffrement proposer_comment » de §Reports est **déjà fermé** (US-2649a).

**Reste US-2650** : endpoint PROPOSE own-id strict (bornes patient) · route `(patient)` + nav +
UI lecture/proposer mode-aware · `InsulinSummary` (conformité DS + fuite client/serveur) · redirect
`/insulin-therapy` VIEWER → route patient.

### Slice 2 — page patient lecture mode-aware + nav (front)
- **Page serveur** `(patient)/patient/insulin-therapy/page.tsx` (pattern `appointments` :
  `force-dynamic`, headers, garde rôle + `accessDenied`, `requireGdprConsent`, `getOwnPatientId`
  own-id strict, message unifié si orphelin). Assemble `buildTreatmentView(getSettings, treatments)`
  serveur (mêmes services que la fiche pro, scopés au dossier propre) → audité par les services.
- **Vue lecture** `PatientInsulinView` (présentationnelle, read-only) : ISF/ICR/basal en créneaux,
  acronymes explicités (`Acronym`), **mode-aware** (non insuliné → état vide, aucune posologie, AC-4).
  Aucune action d'écriture. Design-system + a11y (`aria-labelledby`, skip-link).
- **Nav patient** : item « Insulinothérapie » ajouté à `patientNavItems`.
- i18n namespace `patientInsulin` (fr/en/ar). Tests : +2 (créneaux read-only, état vide non insuliné).
- **PROPOSE patient déjà couvert** par le POST `/api/adjustment-proposals` (VIEWER own-id via
  `resolvePatientId`, bornes patient, `proposerComment` chiffré) → pas de nouvel endpoint.

**Reste US-2650** : UI « proposer » sur la page patient (réutilise `InsulinProposalDialog` +
`PatientRecordProvider`/`usePagePatientMutator`) · `InsulinSummary` (conformité DS) · redirect
`/insulin-therapy` VIEWER (aujourd'hui `(dashboard)/layout` bounce déjà VIEWER → `/patient/dashboard`).
