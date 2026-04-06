-- Contrainte unique partielle : un patient ne peut pas avoir deux entrées actives
-- pour la même insuline du catalogue avec le même usage.
-- Empêche les doublons (ex: 2x Humalog actif en bolus pour le même patient).
CREATE UNIQUE INDEX IF NOT EXISTS patient_insulin_active_unique
ON patient_insulins (patient_id, insulin_catalog_id, usage)
WHERE is_active = true;

-- Contrainte CHECK : customDurationHours doit être dans les bornes cliniques (0.5 - 48.0h)
ALTER TABLE patient_insulins
ADD CONSTRAINT patient_insulin_duration_check
CHECK (custom_duration_hours IS NULL OR (custom_duration_hours >= 0.5 AND custom_duration_hours <= 48.0));

-- Contrainte CHECK : customOnsetMinutes doit être dans les bornes cliniques (1 - 720 min = 12h)
ALTER TABLE patient_insulins
ADD CONSTRAINT patient_insulin_onset_check
CHECK (custom_onset_minutes IS NULL OR (custom_onset_minutes >= 1 AND custom_onset_minutes <= 720));

-- Contrainte : bolusInsulinId et basalInsulinId dans InsulinTherapySettings
-- doivent référencer des PatientInsulin appartenant au même patient.
-- Implémenté via trigger car les CHECK constraints ne supportent pas les sous-requêtes.
CREATE OR REPLACE FUNCTION check_insulin_therapy_patient_match()
RETURNS TRIGGER AS $$
BEGIN
  -- Vérifier bolusInsulinId appartient au même patient
  IF NEW.bolus_insulin_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM patient_insulins
      WHERE id = NEW.bolus_insulin_id AND patient_id = NEW.patient_id
    ) THEN
      RAISE EXCEPTION 'bolusInsulinId (%) does not belong to patient %', NEW.bolus_insulin_id, NEW.patient_id;
    END IF;
  END IF;

  -- Vérifier basalInsulinId appartient au même patient
  IF NEW.basal_insulin_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM patient_insulins
      WHERE id = NEW.basal_insulin_id AND patient_id = NEW.patient_id
    ) THEN
      RAISE EXCEPTION 'basalInsulinId (%) does not belong to patient %', NEW.basal_insulin_id, NEW.patient_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_insulin_therapy_patient_match
BEFORE INSERT OR UPDATE ON insulin_therapy_settings
FOR EACH ROW
EXECUTE FUNCTION check_insulin_therapy_patient_match();

-- Trigger inverse : si patient_insulins.patient_id est modifié,
-- vérifier que les insulin_therapy_settings liés sont toujours cohérents.
CREATE OR REPLACE FUNCTION check_patient_insulin_patient_match()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.patient_id != NEW.patient_id THEN
    IF EXISTS (
      SELECT 1 FROM insulin_therapy_settings
      WHERE (bolus_insulin_id = NEW.id OR basal_insulin_id = NEW.id)
        AND patient_id != NEW.patient_id
    ) THEN
      RAISE EXCEPTION 'Cannot change patient_id on PatientInsulin (%) — still referenced by insulin_therapy_settings for patient %', NEW.id, OLD.patient_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_patient_insulin_patient_match
BEFORE UPDATE ON patient_insulins
FOR EACH ROW
EXECUTE FUNCTION check_patient_insulin_patient_match();
