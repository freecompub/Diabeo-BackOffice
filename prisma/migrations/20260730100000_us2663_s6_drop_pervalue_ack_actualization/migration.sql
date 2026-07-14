-- ═══════════════════════════════════════════════════════════════
-- US-2663 (slice S6) — Retrait des tables ACCUSÉ / ACTUALISATION PAR-VALEUR (destructif)
-- ═══════════════════════════════════════════════════════════════
-- Suite du grouped-only intégral (S5) : la voie par-valeur `AdjustmentProposal` étant retirée en
-- ÉCRITURE, l'accusé patient (US-2065) et l'actualisation (US-2066) sont désormais portés sur la
-- proposition GROUPÉE (`slot_set_proposal_acks` / `slot_set_proposal_actualizations`, US-2663 S5/c4).
-- Les tables par-valeur `adjustment_proposal_acks` / `adjustment_proposal_actualizations` n'ont plus
-- aucun producteur ni consommateur (routes + services + tests retirés) → suppression.
--
-- ⚠️ MIGRATION DESTRUCTIVE (DROP TABLE) — validée : application PAS ENCORE EN PRODUCTION (décision
-- produit D2 de l'épic), donc 0 donnée à risque. `IF EXISTS` + `CASCADE` : rejouable ; `CASCADE` retire
-- index/contraintes de la table (aucun objet externe ne dépend de ces tables — FK sortantes uniquement).

DROP TABLE IF EXISTS "adjustment_proposal_acks" CASCADE;
DROP TABLE IF EXISTS "adjustment_proposal_actualizations" CASCADE;
