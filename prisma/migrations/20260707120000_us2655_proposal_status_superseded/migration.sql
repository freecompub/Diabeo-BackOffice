-- US-2655 — Ajout du statut `superseded` à ProposalStatus.
-- Une proposition passe `superseded` quand un DOCTOR remplace directement le jeu de créneaux
-- (ISF/ICR) du paramètre concerné : le baseline a changé, la proposition en attente est périmée.
-- Distinct de `expired` (TTL) et `rejected` (revue humaine) pour la forensique ; sort de l'index
-- partiel `one_pending_per_slot` (WHERE status = 'pending'), ce qui libère le créneau.
-- Additif, non destructif.
ALTER TYPE "ProposalStatus" ADD VALUE IF NOT EXISTS 'superseded';
