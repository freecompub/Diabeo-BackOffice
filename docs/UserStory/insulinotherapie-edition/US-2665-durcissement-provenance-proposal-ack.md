# US-2665 — Durcissement de provenance sur l'accusé/réponse de proposition (`proposal-ack`)

> 📌 Sous-US de [US-2645](US-2645-EPIC-insulinotherapie-edition-multimode.md) · **back** · Taille **XS**
> · dépend de : US-2664 (frontière de provenance patient), US-2065 (`AdjustmentProposalAck`)
>
> **Statut** : 🟡 spécifiée — **suivi HDS d'US-2664** (finding LOW hors périmètre).
> **Priorité** : BASSE (aucune fuite de dose ; uniquement divulgation d'existence via UUID connu).

## Contexte

US-2664 a rendu la **frontière de provenance patient** complète sur les deux voies de **lecture** des
`AdjustmentProposal` : `GET /api/adjustment-proposals` (liste) **et** `.../summary` (compteurs) sont forcés à
`source=["patient"]` pour un VIEWER (helper `viewerProposalSources`, imposé serveur). L'audit HDS a relevé
une **surface résiduelle hors périmètre** : la route d'**accusé/réponse** `POST/PUT
/api/team/proposal-ack/[proposalId]` (US-2065) scope au `patientId` du VIEWER via `ensureProposalOwnership`
mais **ne filtre pas par `source`**.

## Problème

Un patient qui connaîtrait déjà l'**UUID** d'une proposition `nurse`/`doctor`/`algorithm` sur **son propre**
dossier pourrait l'acquitter / y répondre. **Atténuations fortes** (d'où LOW, pas un blocage) :
- La réponse n'expose **que** `{ id, readAt }` / `{ id, accepted, respondedAt }` — **aucune valeur de dose ni
  paramètre** n'est divulgué.
- L'`id` est un **UUID non énumérable** (pas de sonde d'existence exploitable).
- C'est un flux d'**accusé/réponse**, pas d'**application** (l'accept applicatif reste **DOCTOR-only**).

## Périmètre

- Appliquer la même frontière de provenance qu'à la lecture : pour un **VIEWER**, `ensureProposalOwnership`
  (ou la route `proposal-ack`) doit **refuser** (404, anti-énumération) un `proposalId` dont `source ≠ patient`.
  Réutiliser `viewerProposalSources(role)` (`access-control.ts`) pour une frontière **uniforme** lecture ⇄
  accusé.
- Test : un VIEWER qui acquitte une proposition `nurse`/`doctor`/`algorithm` de son dossier → **404**.

## Critères d'acceptation

- **AC-1** Un VIEWER ne peut acquitter/répondre qu'à une proposition `source=patient` de son dossier ; une
  proposition tierce → 404 (jamais 200, jamais de divulgation d'existence).
- **AC-2** Les pros (NURSE/DOCTOR) — comportement inchangé.
- **AC-3** Aucune régression US-2065 (accusé/actualisation légitimes).

## Note de dette (NIT, hors AC)

`PARAM_LABEL_KEY` (parameterType → libellé i18n) existe en **3 copies** (`insulin-proposal.ts` typé
`ProposableParameter`, `ProposalList.tsx` typé `AdjustableParameter` incl. `fixedDose`, `PendingProposalsCard.tsx`).
Centraliser une source unique `PARAM_LABEL_KEY<AdjustableParameter>` (réconciliation de type) réduirait la
dérive — optionnel, à traiter si l'on touche ces fichiers.

## Sources code

`src/app/api/team/proposal-ack/[proposalId]/route.ts` · `ensureProposalOwnership` · `src/lib/access-control.ts`
(`viewerProposalSources`). Revue : `healthcare-security-auditor`.
