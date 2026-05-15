-- Groupe 7 Batch 1 — Facturation foundation (US-2103 / 2105 / 2107)
--
-- Crée les tables Invoice, InvoiceItem, InvoiceSequence + enums
-- (InvoiceStatus, PaymentMethod), avec triggers PostgreSQL pour
-- garantir l'immuabilité post-issuance (anti-fraude, DGFiP art. 242
-- nonies A CGI) et la machine d'états (draft → issued → paid/cancelled,
-- paid → refunded).

-- ─────────────────────────────────────────────────────────────
-- 0. Healthcare service — colonnes mentions légales (H3 review)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "healthcare_services"
    ADD COLUMN "siret"     VARCHAR(14),
    ADD COLUMN "tva_intra" VARCHAR(15),
    ADD COLUMN "iban"      VARCHAR(34);

-- SIRET = 14 digits exactement (validation Luhn applicative côté service).
ALTER TABLE "healthcare_services"
    ADD CONSTRAINT "healthcare_services_siret_format_chk"
    CHECK ("siret" IS NULL OR "siret" ~ '^[0-9]{14}$');

-- TVA intra FR : FR + 2 digits + 9 digits SIREN. Plus tolérant pour autres pays.
ALTER TABLE "healthcare_services"
    ADD CONSTRAINT "healthcare_services_tva_format_chk"
    CHECK ("tva_intra" IS NULL OR "tva_intra" ~ '^[A-Z]{2}[A-Z0-9]{2,13}$');

-- IBAN : ISO 13616 — 15 à 34 chars alphanum (validation applicative MOD-97).
ALTER TABLE "healthcare_services"
    ADD CONSTRAINT "healthcare_services_iban_format_chk"
    CHECK ("iban" IS NULL OR "iban" ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$');

-- ─────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────

CREATE TYPE "invoice_status" AS ENUM ('draft', 'issued', 'paid', 'cancelled', 'refunded');

CREATE TYPE "payment_method" AS ENUM ('stripe', 'bank_transfer', 'cash', 'other');

-- ─────────────────────────────────────────────────────────────
-- 2. Tables
-- ─────────────────────────────────────────────────────────────

CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "number" VARCHAR(30),
    "country_code" CHAR(2) NOT NULL,
    "cabinet_id" INTEGER NOT NULL,
    "patient_id" INTEGER,
    "total_cents" INTEGER NOT NULL,
    "tax_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "invoice_status" NOT NULL DEFAULT 'draft',
    "payment_method" "payment_method",
    "stripe_payment_intent_id" VARCHAR(50),
    "pdf_url" VARCHAR(500),
    "pdf_hash" CHAR(64),
    "issuer_snapshot" JSONB,
    "customer_snapshot" JSONB,
    "issued_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,
    "refunded_at" TIMESTAMPTZ,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_items" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "quantity" DECIMAL(10, 3) NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "tax_rate" DECIMAL(6, 4) NOT NULL,
    "tax_cents" INTEGER NOT NULL,
    "line_total_cents" INTEGER NOT NULL,
    "teleconsult_acte_id" INTEGER,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_sequences" (
    "id" SERIAL NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────────────────────────
-- 3. Indexes + uniques
-- ─────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");
CREATE UNIQUE INDEX "invoices_country_code_number_key" ON "invoices"("country_code", "number");
CREATE INDEX "invoices_cabinet_id_status_issued_at_idx" ON "invoices"("cabinet_id", "status", "issued_at" DESC);
CREATE INDEX "invoices_patient_id_issued_at_idx" ON "invoices"("patient_id", "issued_at" DESC);
CREATE INDEX "invoices_status_issued_at_idx" ON "invoices"("status", "issued_at");
CREATE INDEX "invoices_created_by_idx" ON "invoices"("created_by");

CREATE UNIQUE INDEX "invoice_items_teleconsult_acte_id_key" ON "invoice_items"("teleconsult_acte_id");
CREATE INDEX "invoice_items_invoice_id_position_idx" ON "invoice_items"("invoice_id", "position");

CREATE UNIQUE INDEX "invoice_sequences_country_code_year_key" ON "invoice_sequences"("country_code", "year");

-- ─────────────────────────────────────────────────────────────
-- 4. Foreign keys
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_cabinet_id_fkey" FOREIGN KEY ("cabinet_id") REFERENCES "healthcare_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "invoices_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invoice_items"
    ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "invoice_items_teleconsult_acte_id_fkey" FOREIGN KEY ("teleconsult_acte_id") REFERENCES "teleconsultation_actes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- 5. CHECK constraints (defense-in-depth)
-- ─────────────────────────────────────────────────────────────

-- US-2105 — Format numéro facture : <country>-<year>-<6digits>.
-- Pattern : 2 lettres MAJ + tiret + 4 digits année + tiret + 6 digits seq.
-- NULL autorisé en draft (number assigné dès status=issued).
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_number_format_chk"
    CHECK (
        "number" IS NULL
        OR "number" ~ '^[A-Z]{2}-[0-9]{4}-[0-9]{6}$'
    );

-- Number obligatoire dès status ≠ draft.
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_number_required_when_issued_chk"
    CHECK ("status" = 'draft' OR "number" IS NOT NULL);

-- issued_at obligatoire dès status ≠ draft.
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_issued_at_required_when_issued_chk"
    CHECK ("status" = 'draft' OR "issued_at" IS NOT NULL);

-- Montants non négatifs.
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_total_cents_nonneg_chk" CHECK ("total_cents" >= 0),
    ADD CONSTRAINT "invoices_tax_cents_nonneg_chk"   CHECK ("tax_cents"   >= 0);

ALTER TABLE "invoice_items"
    ADD CONSTRAINT "invoice_items_quantity_pos_chk"         CHECK ("quantity"          > 0),
    ADD CONSTRAINT "invoice_items_unit_price_nonneg_chk"    CHECK ("unit_price_cents"  >= 0),
    ADD CONSTRAINT "invoice_items_tax_rate_range_chk"       CHECK ("tax_rate"          BETWEEN 0 AND 1),
    ADD CONSTRAINT "invoice_items_tax_cents_nonneg_chk"     CHECK ("tax_cents"         >= 0),
    ADD CONSTRAINT "invoice_items_line_total_nonneg_chk"    CHECK ("line_total_cents"  >= 0),
    ADD CONSTRAINT "invoice_items_position_nonneg_chk"      CHECK ("position"          >= 0);

ALTER TABLE "invoice_sequences"
    ADD CONSTRAINT "invoice_sequences_year_chk"             CHECK ("year"        BETWEEN 2020 AND 2099),
    ADD CONSTRAINT "invoice_sequences_last_number_nonneg"   CHECK ("last_number" >= 0);

-- ─────────────────────────────────────────────────────────────
-- 6. Trigger : immuabilité Invoice post-issuance + FSM
-- ─────────────────────────────────────────────────────────────
--
-- Garantit que les champs financiers et identifiants ne peuvent plus
-- être modifiés une fois la facture émise. La FSM de status est
-- également enforcée côté DB en defense-in-depth (le service layer
-- la valide aussi avec des erreurs lisibles).
--
-- Transitions autorisées :
--   draft     → issued | cancelled
--   issued    → paid   | cancelled
--   paid      → refunded
--   cancelled = terminal (rejet de toute transition sortante)
--   refunded  = terminal

CREATE OR REPLACE FUNCTION enforce_invoice_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- DRAFT can be freely updated (la facture devient `issued` via le service).
    --
    -- H6 (review PR #406) — Defense-in-depth : même en draft, on
    -- interdit la mutation directe de `number` / `issued_at` /
    -- snapshots. Seul le service via `reserveNextInvoiceNumber` peut
    -- les peupler, et toujours dans la même transaction que la
    -- transition `draft → issued`. Empêche un attaquant SQL direct
    -- (shell admin) de forger un numéro en draft puis transitionner.
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
        -- FSM check même pour draft (transitions sortantes).
        IF OLD.status <> NEW.status AND NEW.status NOT IN ('issued', 'cancelled', 'draft') THEN
            RAISE EXCEPTION 'invalid invoice status transition: % -> %', OLD.status, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    -- Champs verrouillés dès que status <> draft.
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

    -- FSM transitions.
    IF OLD.status <> NEW.status THEN
        IF NOT (
            (OLD.status = 'issued'   AND NEW.status IN ('paid', 'cancelled')) OR
            (OLD.status = 'paid'     AND NEW.status = 'refunded')
        ) THEN
            RAISE EXCEPTION 'invalid invoice status transition: % -> %', OLD.status, NEW.status
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_invoice_immutability_trigger
    BEFORE UPDATE ON "invoices"
    FOR EACH ROW
    EXECUTE FUNCTION enforce_invoice_immutability();

-- ─────────────────────────────────────────────────────────────
-- 7. Trigger : DELETE bloqué sauf en draft
-- ─────────────────────────────────────────────────────────────

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

CREATE TRIGGER block_invoice_delete_after_issued_trigger
    BEFORE DELETE ON "invoices"
    FOR EACH ROW
    EXECUTE FUNCTION block_invoice_delete_after_issued();

-- ─────────────────────────────────────────────────────────────
-- 8. Trigger : invoice_items immutables une fois invoice issued
-- ─────────────────────────────────────────────────────────────
--
-- Empêche INSERT/UPDATE/DELETE sur invoice_items si l'invoice parente
-- n'est plus en draft. On lit le status courant via SELECT — si la
-- ligne invoice a déjà été supprimée (CASCADE depuis invoices), on
-- autorise (rien à protéger).

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

CREATE TRIGGER block_invoice_items_after_issued_trigger
    BEFORE INSERT OR UPDATE OR DELETE ON "invoice_items"
    FOR EACH ROW
    EXECUTE FUNCTION block_invoice_items_after_issued();
