-- ═══════════════════════════════════════════════════════════════
-- Groupe 7 Batch 1 — Invoice immutability & FSM enforcement
-- (US-2103 / 2105 / 2107 — DGFiP art. 242 nonies A CGI)
-- ═══════════════════════════════════════════════════════════════
--
-- COPIE CANONIQUE pour audit & review (le code source réel est dans
-- `prisma/migrations/20260515100000_groupe7_batch1_invoice_foundation/migration.sql`).
--
-- M-NEW-4 (review re-2 PR #406) — co-localisation demandée par le
-- reviewer pour parité avec `audit_immutability.sql`. Toute
-- modification doit être faite simultanément sur les deux fichiers
-- (le drift est détecté par la CI `Migrations Drift Check`).
--
-- ─────────────────────────────────────────────────────────────
-- TRIGGER 1 : enforce_invoice_immutability
-- ─────────────────────────────────────────────────────────────
-- Empêche toute mutation des champs financiers / identité / snapshots
-- une fois la facture émise (`status` ≠ `draft`). Applique aussi la
-- machine d'états :
--
--   draft     → issued | cancelled
--   issued    → paid   | cancelled
--   paid      → refunded
--   cancelled = terminal
--   refunded  = terminal
--
-- H6 (review PR #406) : même en `draft`, on bloque la mutation directe
-- de `number`, `issued_at`, et les snapshots tant que `status` reste
-- `draft`. Cela empêche un attaquant SQL direct (shell admin) de
-- forger un numéro en draft avant transition.

CREATE OR REPLACE FUNCTION enforce_invoice_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- DRAFT : freely updatable EXCEPT pour les champs assignés à
    -- l'issuance (number, issued_at, snapshots).
    IF OLD.status = 'draft' THEN
        IF NEW.number IS NOT NULL AND OLD.number IS DISTINCT FROM NEW.number AND NEW.status = 'draft' THEN
            RAISE EXCEPTION 'invoice.number cannot be set while status remains draft' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.issued_at IS NOT NULL AND OLD.issued_at IS DISTINCT FROM NEW.issued_at AND NEW.status = 'draft' THEN
            RAISE EXCEPTION 'invoice.issued_at cannot be set while status remains draft' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.issuer_snapshot IS NOT NULL AND OLD.issuer_snapshot IS DISTINCT FROM NEW.issuer_snapshot AND NEW.status = 'draft' THEN
            RAISE EXCEPTION 'invoice.issuer_snapshot cannot be set while status remains draft' USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.customer_snapshot IS NOT NULL AND OLD.customer_snapshot IS DISTINCT FROM NEW.customer_snapshot AND NEW.status = 'draft' THEN
            RAISE EXCEPTION 'invoice.customer_snapshot cannot be set while status remains draft' USING ERRCODE = 'check_violation';
        END IF;
        -- FSM check (transitions sortantes depuis draft).
        IF OLD.status <> NEW.status AND NEW.status NOT IN ('issued', 'cancelled', 'draft') THEN
            RAISE EXCEPTION 'invalid invoice status transition: % -> %', OLD.status, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    -- POST-DRAFT : champs verrouillés.
    IF OLD.number             IS DISTINCT FROM NEW.number             THEN RAISE EXCEPTION 'invoice.number is immutable after issuance' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.country_code       IS DISTINCT FROM NEW.country_code       THEN RAISE EXCEPTION 'invoice.country_code is immutable after issuance' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.cabinet_id         IS DISTINCT FROM NEW.cabinet_id         THEN RAISE EXCEPTION 'invoice.cabinet_id is immutable after issuance' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.patient_id         IS DISTINCT FROM NEW.patient_id         THEN RAISE EXCEPTION 'invoice.patient_id is immutable after issuance' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.total_cents        IS DISTINCT FROM NEW.total_cents        THEN RAISE EXCEPTION 'invoice.total_cents is immutable after issuance' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.tax_cents          IS DISTINCT FROM NEW.tax_cents          THEN RAISE EXCEPTION 'invoice.tax_cents is immutable after issuance' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.currency           IS DISTINCT FROM NEW.currency           THEN RAISE EXCEPTION 'invoice.currency is immutable after issuance' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.issued_at          IS DISTINCT FROM NEW.issued_at          THEN RAISE EXCEPTION 'invoice.issued_at is immutable after issuance' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.pdf_hash           IS DISTINCT FROM NEW.pdf_hash           AND OLD.pdf_hash IS NOT NULL THEN RAISE EXCEPTION 'invoice.pdf_hash is immutable once set' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.issuer_snapshot    IS DISTINCT FROM NEW.issuer_snapshot    THEN RAISE EXCEPTION 'invoice.issuer_snapshot is immutable after issuance' USING ERRCODE = 'check_violation'; END IF;
    IF OLD.customer_snapshot  IS DISTINCT FROM NEW.customer_snapshot  THEN RAISE EXCEPTION 'invoice.customer_snapshot is immutable after issuance' USING ERRCODE = 'check_violation'; END IF;

    -- FSM (transitions autorisées post-draft).
    IF OLD.status <> NEW.status THEN
        IF NOT (
            (OLD.status = 'issued' AND NEW.status IN ('paid', 'cancelled')) OR
            (OLD.status = 'paid'   AND NEW.status = 'refunded')
        ) THEN
            RAISE EXCEPTION 'invalid invoice status transition: % -> %', OLD.status, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────
-- TRIGGER 2 : block_invoice_delete_after_issued
-- ─────────────────────────────────────────────────────────────
-- DELETE n'est autorisé qu'en draft. Tout DELETE sur une facture
-- déjà émise (issued/paid/cancelled/refunded) doit passer par la
-- transition `cancel` (audit trail conservé).

CREATE OR REPLACE FUNCTION block_invoice_delete_after_issued()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status <> 'draft' THEN
        RAISE EXCEPTION 'cannot DELETE invoice once issued (use cancel transition)'
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────
-- TRIGGER 3 : block_invoice_items_after_issued
-- ─────────────────────────────────────────────────────────────
-- Empêche INSERT / UPDATE / DELETE sur invoice_items si l'invoice
-- parente est déjà issued. Les lignes sont gelées avec la facture.

CREATE OR REPLACE FUNCTION block_invoice_items_after_issued()
RETURNS TRIGGER AS $$
DECLARE
    inv_status "invoice_status";
    inv_id INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN
        inv_id := OLD.invoice_id;
    ELSE
        inv_id := NEW.invoice_id;
    END IF;

    SELECT status INTO inv_status FROM "invoices" WHERE id = inv_id;
    -- inv_status NULL → invoice supprimée (CASCADE), autorisé.
    IF inv_status IS NOT NULL AND inv_status <> 'draft' THEN
        RAISE EXCEPTION 'cannot modify invoice_items after invoice is issued'
            USING ERRCODE = 'check_violation';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;
