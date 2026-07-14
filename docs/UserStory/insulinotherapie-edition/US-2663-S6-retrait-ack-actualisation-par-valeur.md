# US-2663 S6 — Retrait de l'accusé / actualisation PAR-VALEUR

**Épic** : US-2663 « proposition GROUPÉE intégrale » (grouped-only).
**Type** : nettoyage / dette technique (post-S5).
**Statut** : livré.

## Contexte

La slice **S5** a retiré la voie d'ÉCRITURE par-valeur des propositions d'ajustement
(`AdjustmentProposal`) et porté l'accusé patient (US-2065) + l'actualisation (US-2066) sur la
proposition GROUPÉE (`SlotSetProposal`) — modèles `SlotSetProposalAck` /
`SlotSetProposalActualization` (S5/c4).

La revue de la PR #749 avait relevé (observation, non bloquante) que les routes/services
**par-valeur** `proposalAckService` / `proposalActualizationService` et leurs routes
`POST/PUT /api/team/proposal-ack/[proposalId]` + `POST /api/team/proposal-actualization/[proposalId]`
étaient **conservés** « tant que du legacy `AdjustmentProposal` peut exister », à retirer dans un
ticket ultérieur une fois le legacy purgé.

**Décision produit D2** de l'épic : l'application n'est **pas encore en production** → il n'existe
**aucune** donnée `AdjustmentProposal` legacy. La voie par-valeur d'accusé/actualisation n'a donc
plus **aucun producteur ni consommateur** — elle peut être retirée immédiatement.

## Périmètre (ce qui est retiré)

- **Routes** : `src/app/api/team/proposal-ack/[proposalId]/route.ts`,
  `src/app/api/team/proposal-actualization/[proposalId]/route.ts`.
- **Services** : `proposalAckService`, `proposalActualizationService`
  (`src/lib/services/team-workflow.service.ts`).
- **Modèles Prisma** : `AdjustmentProposalAck`, `AdjustmentProposalActualization` + back-relations
  (`AdjustmentProposal.ack/actualization`, `Patient.proposalAcks`, `User.verifiedProposalActualizations`).
- **Tables** : `adjustment_proposal_acks`, `adjustment_proposal_actualizations` — **DROP** (migration
  destructive `20260730100000`, sûre car 0 donnée / hors prod).
- **Tests** : `tests/unit/proposal-ack-route.test.ts` + describes par-valeur de
  `tests/unit/team-workflow.service.test.ts`.

## Conservé (partagé avec la voie groupée)

- `ACK_COMMENT_MAX` (longueur max commentaire chiffré) — utilisé par `slotSetProposalAckService`.
- `VERIFY_VIA_VALUES` / `VerifyVia` — utilisés par `slotSetProposalActualizationService`.
- Valeurs d'audit `AuditResource` `PROPOSAL_ACK` / `PROPOSAL_ACTUALIZATION` — réutilisées par la voie
  groupée (`metadata.model = "slotSet"`).
- Le modèle `AdjustmentProposal` lui-même (lecture / registre : `list`/`summary`/`accept`/`reject`).

## Sécurité / RGPD

- Aucune donnée à risque (hors prod, tables vides).
- La purge RGPD Art. 17 (`deletion.service.ts`) ne référençait pas directement ces tables (elle
  s'appuyait sur la cascade FK depuis `adjustment_proposals`) → aucun changement requis.
- Aucune rupture de contrôle d'accès : la voie GROUPÉE conserve auth + RBAC + frontière de provenance.

## Contrat iOS

**Hors périmètre** (décision projet US-2663 : le contrat iOS n'est plus pris en compte). L'app mobile
utilise désormais les routes groupées `.../slot-set-proposal-ack|actualization/[proposalId]`.
