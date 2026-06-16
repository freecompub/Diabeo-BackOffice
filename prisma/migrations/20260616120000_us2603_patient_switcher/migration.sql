-- US-2603 — Switcher de contexte patient (récemment vus + épinglés).
--
-- Deux tables per-user, additives et non destructives. La portée (périmètre du
-- PS) est appliquée à la LECTURE côté service (intersection avec
-- getAccessiblePatientIds) — la table ne contraint pas le périmètre, elle
-- mémorise l'historique de navigation / les épingles.
--
-- onDelete: Cascade depuis users ET patients : si l'un disparaît (anonymisation
-- RGPD côté user reste non-DELETE, mais suppression patient cascade), l'entrée
-- de navigation disparaît (pas de référence orpheline).

-- CreateTable
CREATE TABLE "recently_viewed_patients" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "viewed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recently_viewed_patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pinned_patients" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "pinned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pinned_patients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recently_viewed_patients_user_id_patient_id_key" ON "recently_viewed_patients"("user_id", "patient_id");

-- CreateIndex
CREATE INDEX "recently_viewed_patients_user_id_viewed_at_idx" ON "recently_viewed_patients"("user_id", "viewed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pinned_patients_user_id_patient_id_key" ON "pinned_patients"("user_id", "patient_id");

-- CreateIndex
CREATE INDEX "pinned_patients_user_id_pinned_at_idx" ON "pinned_patients"("user_id", "pinned_at" DESC);

-- AddForeignKey
ALTER TABLE "recently_viewed_patients" ADD CONSTRAINT "recently_viewed_patients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recently_viewed_patients" ADD CONSTRAINT "recently_viewed_patients_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pinned_patients" ADD CONSTRAINT "pinned_patients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pinned_patients" ADD CONSTRAINT "pinned_patients_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
