# US-2664 — Vue de proposition d'ajustement UNIFIÉE (médecin · infirmière · patient) + divulgation patient sécurisée

> 📌 Sous-US de [US-2645](US-2645-EPIC-insulinotherapie-edition-multimode.md) · **1ʳᵉ étape pragmatique vers
> l'épic** [US-2663](US-2663-EPIC-proposition-groupee-integrale.md) (grouped-only intégral) · **front + petit
> durcissement serveur** · Taille **M** · dépend de : US-2649 (revue), US-2650 (self-service patient), US-2652
> (provenance `ProposalSource`)
>
> **Statut** : 🟡 en cours — design **validé medical-domain-validator** (2026-07-12).
> **Priorité** : moyenne. **Aucune rupture de contrat API.**

## Contexte

Aujourd'hui la proposition d'ajustement est rendue par **3 composants divergents** : `PatientInsulinView`
(self-service patient — n'affiche **aucune** proposition), l'onglet insuline de `PatientRecord` (pro), et
`ReviewClient` (revue/décision médecin). On veut **un seul composant de proposition « façon médecin »**, décliné
par rôle. C'est une **étape pragmatique, sans grouped-only** (l'épic US-2663 traitera la refonte groupée) : elle
n'ajoute qu'un **durcissement serveur** de provenance, aucun changement de contrat.

**Point de sécurité central (validé medical, frontière MDR)** : montrer au patient une **dose proposée non encore
validée** issue d'un soignant/de l'algorithme l'exposerait à une **auto-injection** avant l'arbitrage médecin
(ADR #13). Le patient ne doit voir **que ses propres demandes**.

## Périmètre

### Composant unifié `ProposalList` (présentational, audience-aware)
Un rendu unique de la liste des propositions pending, paramétré par **audience** :

| Rôle | Audience | Voit | Actions |
|---|---|---|---|
| **Médecin** | `clinician` | **toutes** les provenances (patient/infirmière/algorithme/médecin) | **Accepter / Rejeter** (`canDecide`) |
| **Infirmière** | `clinician` | **toutes**, y compris les demandes patient | lecture |
| **Patient** | `patient` | **SES propres demandes uniquement** (`source = patient`) | lecture |

- **Rendu `clinician`** = l'existant riche (libellé, transition `valeur → valeur`, badges provenance/risque
  hypo/dose élevée, blocage `baselineMoved`). Extrait de `ReviewClient.DecisionsStep` → réutilisé (unification).
- **Rendu `patient`** = **sécurisé** : transition de valeur de **sa** demande, **aucun badge de decision-support
  clinicien** (`highDoseWarning`/risque/`baselineMoved`/`changePercent`), **bandeau non-dismissible « En attente de
  validation par votre médecin — ne modifiez pas vos doses »**, ton **non-prescriptif** (« votre demande », jamais
  « nouvelle dose »/« à appliquer »), config **active affichée séparément** (statu quo).

### Durcissement serveur (frontière de sécurité)
- `adjustmentService.list` accepte un filtre **`sources?: ProposalSource[]`** (`where.source IN …`).
- `GET /api/adjustment-proposals` : pour un **VIEWER** (patient), `sources` est **forcé à `["patient"]` SERVEUR**,
  jamais depuis la query (un filtre uniquement côté UI n'est pas une frontière — la donnée transiterait dans le
  navigateur). Les **pros** (NURSE/DOCTOR) : aucune restriction.

### Invariants conservés (inchangés)
- **« 1 proposition pending / (patient × paramètre × créneau) », premier arrivé gagne** (index
  `adjustment_proposals_one_pending_per_slot`) — une 2ᵉ sur le même créneau est refusée (`duplicatePendingProposal`,
  409). Décision produit : **on garde ce comportement** (option « a »).
- Provenance `source` dérivée **serveur** (ADR #27) ; `proposerComment` (ciphertext) **jamais** exposé
  (`omit` au service). Jamais auto-appliqué (ADR #13) ; Accepter/Rejeter = **DOCTOR** uniquement.

## Critères d'acceptation

- **AC-1** Un **patient** (VIEWER) qui liste ses propositions ne reçoit **que** `source=patient` — vérifié que la
  restriction est **imposée serveur** et **insensible à une query hostile** (`?sources=nurse` ignoré).
- **AC-2** Un **pro** (NURSE/DOCTOR) reçoit **toutes** les provenances, y compris les demandes patient.
- **AC-3** Le rendu **patient** n'affiche **aucun** badge clinicien (dose élevée / risque hypo / baselineMoved /
  %), affiche le **bandeau non-dismissible** « ne modifiez pas vos doses », ton non-prescriptif.
- **AC-4** Le rendu **médecin** conserve à l'identique : transition de valeur, badges, blocage `baselineMoved`,
  Accepter/Rejeter — **aucune régression** de l'écran de revue.
- **AC-5** L'**infirmière** voit la liste complète (dont patient) en **lecture** (pas d'Accepter/Rejeter).
- **AC-6** **Aucun changement de contrat API** (endpoints inchangés ; `list()` gagne un paramètre serveur optionnel).
- **AC-7** Le composant `ProposalList` est **unique** et utilisé par les 3 surfaces (unification effective).
- **AC-8** i18n FR/EN/AR (libellés patient sûrs) ; a11y (bandeau `role="status"`, boutons ARIA) ; tests par audience.

## Hors périmètre (tracé)

- **Grouped-only** (proposition = disposition entière, moteur inclus) → **épic US-2663** (refonte lourde,
  garde-fou CAS par-créneau, re-sourcing anti-ratchet…). **Cette US ne touche pas** au modèle par-valeur.
- **Le patient voit les propositions de l'infirmière** → **NO-GO par défaut** (medical) : dose soignante non
  validée = risque d'auto-injection. Nécessite revue **MDR/DPIA + masquage de la valeur cible** → US dédiée.
- **L'infirmière corrige une proposition patient** → capacité **nouvelle** (édition en place / supersession /
  rejet+recréation) avec décision de **provenance/responsabilité** → US dédiée (valider medical + architect).

## Décisions & garde-fous (validés medical, à ne pas régresser)

1. Filtre `source` **serveur** (jamais UI-only). 2. Rendu patient **sans badges decision-support**. 3. Bandeau
**non-dismissible** « ne modifiez pas vos doses ». 4. Ton **non-prescriptif**. 5. Config active affichée séparément.
6. Lecture stricte patient (Accepter/Rejeter = DOCTOR). 7. Provenance serveur, `proposerComment` jamais exposé.

## Sources code

`src/lib/services/adjustment.service.ts` (`list` — filtre `sources`) · `src/app/api/adjustment-proposals/route.ts`
(GET — `sources` forcé VIEWER) · `src/app/(dashboard)/patients/[id]/review/ReviewClient.tsx` (`DecisionsStep` →
extraction) · `src/components/diabeo/patient/PatientInsulinView.tsx` + `(patient)/patient/insulin-therapy/page.tsx`
(surface patient) · `PatientRecord.tsx` (surface pro) · catalogue `docs/clinical-logic/regles-et-constantes-diabete.md`
(règle de divulgation patient, §6).
