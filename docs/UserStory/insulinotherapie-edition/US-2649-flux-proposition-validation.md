# US-2649 — Flux proposition → validation : provenance, notifications, UI de validation

> 📌 Épic US-2645 · front + back · Taille **L** · dépend de : US-2646

## Contexte
Une proposition (patient ou infirmier) doit **notifier** le médecin et être **validée/rejetée**
explicitement. L'écran de validation existe déjà (`/adjustment-proposals`) mais est **orphelin**
(cf. `docs/inventory/composants-orphelins.md`) ; le service push existe (`push.service.ts`).

## Périmètre
- **Création de proposition** avec provenance (`proposedByRole`, `proposedByUserId`, US-2646),
  `status=pending`, bornes **rejetées à la création** (`validateProposedValue` étendu), `applyImmediately`
  **désactivé** pour non-DOCTOR.
- **Notification** au(x) médecin(s) référent(s)/équipe via `push.service.ts` (+ éventuel in-app),
  sans PHI dans le payload.
- **UI de validation** : **surfacer `/adjustment-proposals`** (entrée de nav pro / badge « à valider »
  sur la fiche) ; liste `pending` avec accept/reject, lien fiche, provenance affichée (patient vs infirmier),
  motif + justification (`AdjustmentProposalAck.comment`).
- **accept()** applique la valeur (mode-aware : ISF/ICR/basal **ou** dose fixe), re-vérifie les bornes,
  écrit `reviewedBy`/`reviewedAt`, audite ; **reject()** clôt sans appliquer, audite. Accusé patient
  (`AdjustmentProposalAck`) sur décision.
- **Validateur = DOCTOR** (défaut D2/D3 — à reconfirmer : NURSE peut-il valider ?).

## Critères d'acceptation
- **AC-1** Une proposition patient/infirmier crée une `pending` auditée avec provenance ; jamais appliquée seule.
- **AC-2** Le médecin reçoit une **notification** (sans PHI) et voit la proposition dans `/adjustment-proposals`.
- **AC-3** accept → valeur appliquée (mode-aware) + re-check bornes + audit `reviewedBy` ; reject → aucun effet + audit.
- **AC-4** Anti-spam : 1 `pending` max par paramètre/slot + cooldown (72 h) respecté.
- **AC-5** `/adjustment-proposals` accessible via nav (n'est plus orpheline).

## Notes
- Réutiliser `AdjustmentProposalActualization` (US-2066) pour le suivi d'effet si pertinent.

## Révision post-revue (archi + HDS) — SCINDÉE, voir épic §12
**US-2649 est scindée** (le cycle 2648⇄2649 doit être cassé) :
- **US-2649a (socle create)** — primitive `createProposal` : provenance **dérivée serveur**, **bornes vérifiées à la création**, `validateProposedValue` étendu (`fixedDose`), **anti-spam** (index unique partiel PG `WHERE status='pending'` + cooldown 72 h). Livrée **avant US-2648**.
- **US-2649b (surface)** — notifications push **sans PHI** (`data={type, proposalId}`, corps générique) + UI `/adjustment-proposals` (surfacée) + **accept/reject mode-aware**. Après 2648/2651.
- **`accept()` sûr** : `count === 1` obligatoire (TOCTOU `updateMany`), **re-lecture valeur courante** + revalidation delta vs `currentValue` figée (drift → refus auto), double gate `validateProposedValue` (create + accept), `applyImmediately=false` si `source != DOCTOR` (§12).
- **Validation = DOCTOR exact + `canAccessPatient`** (ADMIN exclu) (§12.8).
- **Audit sans PHI** : `resourceId=proposalId`, `metadata={patientId, proposedByRole}` ; jamais la dose (§12 nit).
- Dépendances corrigées : dépend aussi de **2647** et **2651**.

## Reports de la revue code+migration (PR #638 / US-2646) — à fermer ici
Invariants laissés volontairement « ouverts » par le socle, à fermer côté service :
- **Provenance dérivée serveur** (2649a) : `source` + `proposedByUserId` depuis la **session**, jamais du body (anti-usurpation). **Nuller** `confidence`/`supportingEvents` quand `source != algorithm` (le CHECK DB ne l'impose pas). *(HDS MEDIUM, prisma)*
- **Audit à la création** (2649b, **bloquant**) : enregistrer l'auteur (`metadata={patientId, proposedByRole}`) **dès la création** — sinon la suppression RGPD (FK SetNull) perd le lien forensique. *(HDS HIGH-dépendance)*
- **Affichage basé sur `source`, pas `confidence`** (2649b) : ne jamais rendre une proposition non-`algorithm` comme « moteur » (une `confidence` bidon ne doit pas tromper le médecin qui valide). *(HDS LOW — sécurité clinique)*
- **Notif sans PHI** : `data={type, proposalId}`, corps générique (déjà prévu).
- **Index unique partiel** : `clinical_review_flags(patient_id, type) WHERE status='open'` (précédent `emergency_alerts_one_live_per_type`) pour éviter le spam de flags. *(prisma)*
- **Écriture `fixedDose` dans `accept()`** : aujourd'hui **fail-closed** (throw `fixedDoseApplyNotImplemented`) → câbler l'écriture réelle dans `fixed_dose_slots` ; **activer les caps delta** (`FIXED_DOSE_MAX_DELTA_U` / `FIXED_DOSE_PATIENT_MAX_DELTA_U`, inertes au socle) ; **router les seuils d'avertissement** (`FIXED_BOLUS_WARN_U` / `FIXED_BASAL_WARN_U`) selon `PatientInsulin.usage` (basal vs bolus). *(code-review + medical)*

## Reports de la revue US-2649a (PR #642) — obligations & suites
**Fermé par US-2649a** : provenance dérivée serveur, `currentValue` **dérivé serveur** (garde-fous ininviolables), bornes à la création, `changePercent` clampé (anti-overflow), anti-spam (index partiel `prisma/sql/adjustment_proposal_one_pending.sql` + P2002), `proposerComment` chiffré, audit sans PHI, `fixedDose` **rejeté** (fail-closed).

**Obligations ROUTE (US-2648/2650, bloquantes)** — la primitive fait confiance à l'appelant :
- `canAccessPatient(user, patientId)` + un **patient ne propose que sur SON dossier** (session.patientId === input.patientId).
- Mapper le **rôle session → `patient|nurse|doctor`** (rejeter ADMIN/VIEWER en 400).
- **Ne pas renvoyer `proposerComment`** (ciphertext) dans la réponse API (strip DTO).
- **Appliquer l'index partiel** `prisma/sql/adjustment_proposal_one_pending.sql` en prod + **rate-limit** des créations patient.

**fixedDose** — pour dé-rejeter la dose fixe : ajouter un **discriminateur de moment** sur `AdjustmentProposal` (ou objet dédié) + câbler `FixedDoseSlot` (US-2648/2649b).

## US-2649b (en cours) — slice 1 : provenance & direction de risque à la revue médecin
Enrichit `/adjustment-proposals` (file de revue) avec des findings différés :
- **Badge provenance** (`source`) : « demande patient » mis en avant (default), soignant/médecin/algorithme en outline — le médecin voit immédiatement l'origine (finding US-2648b : `source=patient` ≠ `reason`).
- **Badge direction de risque** : `deriveRiskDirection` (pur, testé) surface l'**hypo** (ambre) vs hyper — plus de cap-and-hide (finding clinique US-2649a). Catalogue §6.
- i18n `adjustments.source.*` / `adjustments.risk.*` (fr/en/ar). Tests : 5.

**Reste US-2649b** : confiance basée sur `source` (pas `confidence`) dans l'UI ; **débit/valeur LIVE** à l'accept (pas le snapshot) + re-scoping patient de l'apply basal ; notifications push (sans PHI) ; ne pas exposer `proposerComment` (ciphertext) dans la réponse GET list.

#### Corrections revue slice 1 (PR #652)
- **HDS (fermé)** : `proposerComment` (ciphertext) n'est plus émis dans la réponse GET `list` — strippé au **service** (`omit`), donc tout consommateur est protégé (pas seulement la route). Décryptage pour le médecin = tranche future.
- **fail-closed** : `deriveRiskDirection` renvoie `none` sur un `parameterType` inconnu (pas de verdict deviné) + test.
- Confirmé clinique : les 4 directions correctes ; magnitude déjà affichée à côté du badge (anti alarm-fatigue).

#### US-2649b slice 2 : durcissement de l'apply à l'accept
- L'application d'une proposition **basale** acceptée est désormais **re-scopée au patient** (`updateMany` sur `id` + `basalConfig.settings.patientId`) comme ISF/ICR — un `pumpBasalSlotId` hors patient ne matche pas (**anti-IDOR défense en profondeur**), `count 0 → pumpSlotNotFound` (fail-closed). Avant : `update` par id seul.
- Tests : +2 (apply basal scopé + pumpSlotNotFound).

**Reste US-2649b** : confiance basée sur `source` dans l'UI ; valeur LIVE affichée à l'accept ; notifications push.

##### Corrections revue slice 2 (PR #653)
- **Garde fail-closed uniformisé** sur les **3 paramètres** à l'accept : helper `assertRowApplied(count, code)` → ISF/ICR (comme le basal) lèvent `isfSlotNotFound`/`icrSlotNotFound` si le créneau a disparu/bougé entre proposition et accept → **plus de « accepté + appliqué » fantôme** (le rollback annule le statut). Ferme le finding HDS de cohérence (pré-existant, rendu visible par contraste).
- Tests : +1 (ISF phantom-accept).

#### US-2649b slice 3 : notification du médecin référent à la création
- `createProposal` notifie le **médecin référent** du patient (push FCM) qu'une proposition est à revoir. **Best-effort et HORS transaction** : un échec push n'annule jamais la création (déjà commitée). Ne se notifie pas soi-même (référent qui propose). **Aucun PHI/dose** dans le message ; `data.type = proposal_review`. Symétrique à `notifyPatient` (accept/reject).
- Tests : +4 (push référent, no-self-notify, pas de référent, best-effort sur échec push).

**Reste US-2649b** : confiance basée sur `source` (UI) ; valeur LIVE affichée à l'accept.
