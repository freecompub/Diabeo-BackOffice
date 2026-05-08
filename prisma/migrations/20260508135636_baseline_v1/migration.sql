-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'DOCTOR', 'NURSE', 'VIEWER');

-- CreateEnum
CREATE TYPE "Pathology" AS ENUM ('DT1', 'DT2', 'GD');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('M', 'F', 'X');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('fr', 'en', 'ar');

-- CreateEnum
CREATE TYPE "DayMomentType" AS ENUM ('morning', 'noon', 'evening', 'night', 'custom');

-- CreateEnum
CREATE TYPE "InsulinDeliveryMethod" AS ENUM ('pump', 'manual');

-- CreateEnum
CREATE TYPE "TreatmentType" AS ENUM ('fgm', 'pump', 'insulin_pump', 'glp1');

-- CreateEnum
CREATE TYPE "BasalConfigType" AS ENUM ('pump', 'single_injection', 'split_injection');

-- CreateEnum
CREATE TYPE "GlucoseTargetPreset" AS ENUM ('standard', 'tight', 'pediatric', 'elderly', 'custom');

-- CreateEnum
CREATE TYPE "AdjustableParameter" AS ENUM ('basalRate', 'insulinSensitivityFactor', 'insulinToCarbRatio');

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('basalTooLow', 'basalTooHigh', 'basalCorrect', 'isfTooLow', 'isfTooHigh', 'isfCorrect', 'icrTooLow', 'icrTooHigh', 'icrCorrect', 'insufficientData');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('pending', 'accepted', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "DeviceCategory" AS ENUM ('glucometer', 'cgm', 'insulinPump', 'insulinPen', 'healthApp');

-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('general', 'forDoctor', 'personal', 'prescription', 'labResults', 'other');

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('ios', 'android', 'web');

-- CreateEnum
CREATE TYPE "PushNotifStatus" AS ENUM ('pending', 'sent', 'delivered', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('once', 'daily', 'weekly', 'custom_cron');

-- CreateEnum
CREATE TYPE "IosInterruptionLevel" AS ENUM ('passive', 'active', 'time_sensitive', 'critical');

-- CreateEnum
CREATE TYPE "DiabetesEventType" AS ENUM ('glycemia', 'insulinMeal', 'physicalActivity', 'context', 'occasional');

-- CreateEnum
CREATE TYPE "AndroidPriority" AS ENUM ('normal', 'high');

-- CreateEnum
CREATE TYPE "InsulinUsage" AS ENUM ('bolus', 'basal', 'both');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('clinic', 'hospital', 'freelance');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "EmergencyAlertType" AS ENUM ('severe_hypo', 'hypo', 'severe_hyper', 'hyper', 'ketone_dka', 'ketone_moderate', 'manual');

-- CreateEnum
CREATE TYPE "EmergencyAlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "EmergencyAlertStatus" AS ENUM ('open', 'acknowledged', 'resolved', 'expired');

-- CreateEnum
CREATE TYPE "HypoSugarType" AS ENUM ('glucose_tabs', 'juice', 'candy', 'honey', 'sugar_packets', 'other');

-- CreateEnum
CREATE TYPE "EmergencyAlertActionType" AS ENUM ('acknowledge', 'call_patient', 'adjust_treatment', 'send_message', 'resolve', 'escalate');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('current', '7d', '30d');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "email_hmac" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "title" TEXT,
    "firstname" TEXT,
    "firstname_hmac" TEXT,
    "firstnames" TEXT,
    "used_firstname" TEXT,
    "lastname" TEXT,
    "lastname_hmac" TEXT,
    "used_lastname" TEXT,
    "birthday" DATE,
    "sex" "Sex",
    "code_birth_place" TEXT,
    "timezone" TEXT DEFAULT 'Europe/Paris',
    "phone" TEXT,
    "address1" TEXT,
    "address2" TEXT,
    "cp" TEXT,
    "city" TEXT,
    "country" CHAR(2),
    "pic" TEXT,
    "language" "Language" DEFAULT 'fr',
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "status_changed_at" TIMESTAMPTZ,
    "status_changed_by" INTEGER,
    "mfa_secret" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_last_used_step" INTEGER,
    "has_signed_terms" BOOLEAN NOT NULL DEFAULT false,
    "profile_complete" BOOLEAN NOT NULL DEFAULT false,
    "need_data_policy_update" BOOLEAN NOT NULL DEFAULT false,
    "data_policy_update" TIMESTAMP(3),
    "need_password_update" BOOLEAN NOT NULL DEFAULT false,
    "need_onboarding" BOOLEAN NOT NULL DEFAULT false,
    "debug" BOOLEAN NOT NULL DEFAULT false,
    "nirpp" TEXT,
    "nirpp_type" TEXT,
    "nirpp_policyholder" TEXT,
    "nirpp_policyholder_type" TEXT,
    "oid" TEXT,
    "ins" TEXT,
    "intercom_hash" TEXT,
    "deployment_key" TEXT,
    "pro" TEXT,
    "photo_url" VARCHAR(500),
    "display_modal_tls_mutual" BOOLEAN NOT NULL DEFAULT false,
    "display_modal_tls_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "mfa_verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "user_unit_preferences" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "unit_glycemia" INTEGER NOT NULL DEFAULT 5,
    "unit_weight" INTEGER NOT NULL DEFAULT 6,
    "unit_size" INTEGER NOT NULL DEFAULT 8,
    "unit_carb" INTEGER NOT NULL DEFAULT 2,
    "unit_hba1c" INTEGER NOT NULL DEFAULT 10,
    "unit_carb_exchange_nb" INTEGER NOT NULL DEFAULT 15,
    "unit_ketones" INTEGER NOT NULL DEFAULT 12,
    "unit_blood_pressure" INTEGER NOT NULL DEFAULT 14,

    CONSTRAINT "user_unit_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_preferences" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "notif_message_mail" BOOLEAN NOT NULL DEFAULT true,
    "notif_document_mail" BOOLEAN NOT NULL DEFAULT true,
    "glycemia_reminders" BOOLEAN NOT NULL DEFAULT false,
    "glycemia_reminder_times" JSONB,
    "insulin_reminders" BOOLEAN NOT NULL DEFAULT false,
    "insulin_reminder_times" JSONB,
    "medical_appointments" BOOLEAN NOT NULL DEFAULT true,
    "auto_export" BOOLEAN NOT NULL DEFAULT false,
    "auto_export_frequency" INTEGER,

    CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_privacy_settings" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "share_with_researchers" BOOLEAN NOT NULL DEFAULT false,
    "share_with_providers" BOOLEAN NOT NULL DEFAULT true,
    "analytics_enabled" BOOLEAN NOT NULL DEFAULT true,
    "gdpr_consent" BOOLEAN NOT NULL DEFAULT false,
    "consent_date" TIMESTAMP(3),

    CONSTRAINT "user_privacy_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_day_moments" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" "DayMomentType" NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_day_moments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ui_state_save" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" VARCHAR(255),

    CONSTRAINT "ui_state_save_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "pathology" "Pathology" NOT NULL,
    "pregnancy_mode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_medical_data" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "dt1" BOOLEAN,
    "size" DECIMAL(5,2),
    "year_diag" INTEGER,
    "insulin" BOOLEAN,
    "insulin_year" INTEGER,
    "insulin_pump" BOOLEAN,
    "pathology" VARCHAR(100),
    "diabet_discovery" TEXT,
    "tabac" BOOLEAN,
    "alcool" BOOLEAN,
    "history_medical" TEXT,
    "history_chirurgical" TEXT,
    "history_family" TEXT,
    "history_allergy" TEXT,
    "history_vaccine" TEXT,
    "history_life" TEXT,
    "risk_weight" BOOLEAN NOT NULL DEFAULT false,
    "risk_tension" BOOLEAN NOT NULL DEFAULT false,
    "risk_sedent" BOOLEAN NOT NULL DEFAULT false,
    "risk_cholesterol" BOOLEAN NOT NULL DEFAULT false,
    "risk_age" BOOLEAN NOT NULL DEFAULT false,
    "risk_heredit" BOOLEAN NOT NULL DEFAULT false,
    "risk_cardio" BOOLEAN NOT NULL DEFAULT false,
    "risk_hypothyroidism" BOOLEAN NOT NULL DEFAULT false,
    "risk_celiac" BOOLEAN NOT NULL DEFAULT false,
    "risk_other_autoimmune" BOOLEAN NOT NULL DEFAULT false,
    "vitale_attest" TEXT,

    CONSTRAINT "patient_medical_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_administrative" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "regime_ald" BOOLEAN NOT NULL DEFAULT false,
    "date_start_maternite" DATE,
    "has_mutual" BOOLEAN NOT NULL DEFAULT false,
    "mutual_file_recto" VARCHAR(500),
    "mutual_file_verso" VARCHAR(500),

    CONSTRAINT "patient_administrative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_pregnancy" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "due_date" DATE,
    "gestational_age" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_pregnancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "glycemia_objectives" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "limit_em_white" DECIMAL(4,2),
    "limit_em_green" DECIMAL(4,2),
    "limit_em_orange" DECIMAL(4,2),
    "limit_bm_white" DECIMAL(4,2),
    "limit_bm_green" DECIMAL(4,2),
    "limit_bm_orange" DECIMAL(4,2),
    "limit_am_white" DECIMAL(4,2),
    "limit_am_green" DECIMAL(4,2),
    "limit_am_orange" DECIMAL(4,2),
    "limit_am1h_white" DECIMAL(4,2),
    "limit_am1h_green" DECIMAL(4,2),
    "limit_am1h_orange" DECIMAL(4,2),

    CONSTRAINT "glycemia_objectives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cgm_objectives" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "very_low" DECIMAL(4,2) NOT NULL DEFAULT 0.54,
    "low" DECIMAL(4,2) NOT NULL DEFAULT 0.70,
    "ok" DECIMAL(4,2) NOT NULL DEFAULT 1.80,
    "high" DECIMAL(4,2) NOT NULL DEFAULT 2.50,
    "titr_low" DECIMAL(4,2) NOT NULL DEFAULT 0.70,
    "titr_high" DECIMAL(4,2) NOT NULL DEFAULT 1.80,

    CONSTRAINT "cgm_objectives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "annex_objectives" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "objective_hba1c" DECIMAL(4,2),
    "objective_min_weight" DECIMAL(5,2),
    "objective_max_weight" DECIMAL(5,2),
    "objective_walk" INTEGER,

    CONSTRAINT "annex_objectives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_threshold_configs" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "alert_on_hypo" BOOLEAN NOT NULL DEFAULT true,
    "alert_on_severe_hypo" BOOLEAN NOT NULL DEFAULT true,
    "alert_on_hyper" BOOLEAN NOT NULL DEFAULT false,
    "alert_on_severe_hyper" BOOLEAN NOT NULL DEFAULT true,
    "notify_doctor_push" BOOLEAN NOT NULL DEFAULT true,
    "notify_doctor_email" BOOLEAN NOT NULL DEFAULT true,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "alert_threshold_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ketone_thresholds" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "light_threshold" DECIMAL(3,1) NOT NULL DEFAULT 0.6,
    "moderate_threshold" DECIMAL(3,1) NOT NULL DEFAULT 1.5,
    "dka_threshold" DECIMAL(3,1) NOT NULL DEFAULT 3.0,
    "alert_on_moderate" BOOLEAN NOT NULL DEFAULT true,
    "alert_on_dka" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ketone_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hypo_treatment_protocols" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "sugar_type" "HypoSugarType" NOT NULL DEFAULT 'glucose_tabs',
    "sugar_type_other" VARCHAR(200),
    "fast_carbs_grams" INTEGER NOT NULL DEFAULT 15,
    "retest_minutes" INTEGER NOT NULL DEFAULT 15,
    "allergies" TEXT,
    "instructions" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "hypo_treatment_protocols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_alerts" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "alert_type" "EmergencyAlertType" NOT NULL,
    "severity" "EmergencyAlertSeverity" NOT NULL DEFAULT 'warning',
    "status" "EmergencyAlertStatus" NOT NULL DEFAULT 'open',
    "triggered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "glucose_value_mgdl" DECIMAL(6,2),
    "ketone_value_mmol" DECIMAL(4,2),
    "context_snapshot" TEXT,
    "notes" TEXT,
    "acknowledged_by" INTEGER,
    "acknowledged_at" TIMESTAMPTZ,
    "resolved_by" INTEGER,
    "resolved_at" TIMESTAMPTZ,
    "resolution_notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "emergency_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_alert_actions" (
    "id" SERIAL NOT NULL,
    "alert_id" INTEGER NOT NULL,
    "performed_by" INTEGER NOT NULL,
    "action_type" "EmergencyAlertActionType" NOT NULL,
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_alert_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treatments" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "type" "TreatmentType" NOT NULL,
    "name" VARCHAR(100),
    "other" TEXT,
    "posology" TEXT,
    "posology_data" JSONB,
    "treatment_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "treatments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "basal_flow_schedules" (
    "id" SERIAL NOT NULL,
    "treatment_id" INTEGER NOT NULL,
    "label" VARCHAR(50),
    "schedule_start" TIME NOT NULL,
    "schedule_rate" DECIMAL(5,3) NOT NULL,

    CONSTRAINT "basal_flow_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insulin_catalog" (
    "id" SERIAL NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "generic_name" VARCHAR(100) NOT NULL,
    "typical_onset_minutes" INTEGER NOT NULL,
    "typical_peak_minutes" INTEGER,
    "typical_duration_hours" DECIMAL(4,1) NOT NULL,
    "is_faster_acting" BOOLEAN NOT NULL DEFAULT false,
    "is_traditional_rapid_acting" BOOLEAN NOT NULL DEFAULT false,
    "is_long_acting" BOOLEAN NOT NULL DEFAULT false,
    "approval_year" INTEGER,
    "manufacturer" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "insulin_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_insulins" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "insulin_catalog_id" INTEGER NOT NULL,
    "usage" "InsulinUsage" NOT NULL,
    "custom_duration_hours" DECIMAL(4,1),
    "custom_onset_minutes" INTEGER,
    "dosage" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "start_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" DATE,
    "prescribed_by" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "patient_insulins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insulin_therapy_settings" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "bolus_insulin_id" INTEGER,
    "basal_insulin_id" INTEGER,
    "delivery_method" "InsulinDeliveryMethod" NOT NULL,
    "last_modified" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insulin_therapy_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "glucose_targets" (
    "id" TEXT NOT NULL,
    "settings_id" INTEGER NOT NULL,
    "target_glucose" DECIMAL(6,2) NOT NULL,
    "target_range_lower" DECIMAL(4,2) NOT NULL DEFAULT 0.70,
    "target_range_upper" DECIMAL(4,2) NOT NULL DEFAULT 1.80,
    "preset" "GlucoseTargetPreset",
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "glucose_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "iob_settings" (
    "id" SERIAL NOT NULL,
    "settings_id" INTEGER NOT NULL,
    "consider_iob" BOOLEAN NOT NULL DEFAULT true,
    "action_duration_hours" DECIMAL(4,2) NOT NULL DEFAULT 4.0,

    CONSTRAINT "iob_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extended_bolus_settings" (
    "id" SERIAL NOT NULL,
    "settings_id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "immediate_percentage" DECIMAL(5,2) NOT NULL DEFAULT 100.0,
    "extended_duration_hours" DECIMAL(4,2),

    CONSTRAINT "extended_bolus_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insulin_sensitivity_factors" (
    "id" TEXT NOT NULL,
    "settings_id" INTEGER NOT NULL,
    "start_hour" SMALLINT NOT NULL,
    "end_hour" SMALLINT NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "sensitivity_factor_gl" DECIMAL(6,4) NOT NULL,
    "sensitivity_factor_mgdl" DECIMAL(6,2) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "insulin_sensitivity_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carb_ratios" (
    "id" TEXT NOT NULL,
    "settings_id" INTEGER NOT NULL,
    "start_hour" SMALLINT NOT NULL,
    "end_hour" SMALLINT NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "grams_per_unit" DECIMAL(5,2) NOT NULL,
    "meal_label" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "carb_ratios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "basal_configurations" (
    "id" SERIAL NOT NULL,
    "settings_id" INTEGER NOT NULL,
    "config_type" "BasalConfigType" NOT NULL,
    "total_daily_dose" DECIMAL(6,2),
    "morning_dose" DECIMAL(5,2),
    "evening_dose" DECIMAL(5,2),
    "daily_dose" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "basal_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pump_basal_slots" (
    "id" TEXT NOT NULL,
    "basal_config_id" INTEGER NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "rate" DECIMAL(5,3) NOT NULL,
    "duration_hours" DECIMAL(5,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pump_basal_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bolus_calculation_logs" (
    "id" TEXT NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "calculated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "input_glucose_gl" DECIMAL(6,4),
    "input_carbs_grams" DECIMAL(6,2),
    "target_glucose_mgdl" DECIMAL(6,2) NOT NULL,
    "isf_used_gl" DECIMAL(6,4) NOT NULL,
    "icr_used" DECIMAL(5,2) NOT NULL,
    "meal_bolus" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "raw_correction_dose" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "iob_value" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "iob_adjustment" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "correction_dose" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "recommended_dose" DECIMAL(5,2) NOT NULL,
    "was_capped" BOOLEAN NOT NULL DEFAULT false,
    "warnings" TEXT[],
    "delivery_method" VARCHAR(20) NOT NULL,
    "was_delivered" BOOLEAN NOT NULL DEFAULT false,
    "extended_immediate_pct" DECIMAL(5,2),
    "extended_duration_hours" DECIMAL(4,2),

    CONSTRAINT "bolus_calculation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustment_proposals" (
    "id" TEXT NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "parameter_type" "AdjustableParameter" NOT NULL,
    "current_value" DECIMAL(8,4) NOT NULL,
    "proposed_value" DECIMAL(8,4) NOT NULL,
    "change_percent" DECIMAL(5,2) NOT NULL,
    "confidence" "ConfidenceLevel" NOT NULL,
    "reason" "AdjustmentReason" NOT NULL,
    "supporting_events" INTEGER NOT NULL,
    "total_events_considered" INTEGER,
    "excluded_events" INTEGER,
    "average_observed_value" DECIMAL(8,4),
    "time_slot_start_hour" SMALLINT,
    "time_slot_end_hour" SMALLINT,
    "carb_ratio_slot_start" SMALLINT,
    "carb_ratio_slot_end" SMALLINT,
    "pump_basal_slot_id" TEXT,
    "analysis_period" VARCHAR(10),
    "data_quality" VARCHAR(20),
    "status" "ProposalStatus" NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMPTZ,
    "reviewed_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adjustment_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cgm_entries" (
    "id" BIGSERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "value_gl" DECIMAL(6,4) NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "is_manual" BOOLEAN NOT NULL DEFAULT false,
    "device_id" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cgm_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "glycemia_entries" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "time" TIME,
    "is_professional" BOOLEAN NOT NULL DEFAULT false,
    "glycemia_gl" DECIMAL(6,4),
    "glycemia_mgdl" DECIMAL(6,2),
    "weight" DECIMAL(5,2),
    "hba1c" DECIMAL(5,2),
    "ketones" DECIMAL(5,2),
    "bp_systolic" SMALLINT,
    "bp_diastolic" SMALLINT,
    "bolus" DECIMAL(5,2),
    "bolus_corr" DECIMAL(5,2),
    "basal" DECIMAL(5,2),
    "insulin_device" INTEGER,
    "carb" INTEGER,
    "meal_description" TEXT,
    "meal_full_starchy" BOOLEAN,
    "meal_protein" BOOLEAN,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "glycemia_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diabetes_events" (
    "id" TEXT NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "event_date" TIMESTAMPTZ NOT NULL,
    "event_types" "DiabetesEventType"[],
    "glycemia_value" DECIMAL(6,2),
    "carbohydrates" DECIMAL(6,2),
    "bolus_dose" DECIMAL(5,2),
    "basal_dose" DECIMAL(5,2),
    "activity_type" VARCHAR(20),
    "activity_duration" INTEGER,
    "context_type" VARCHAR(20),
    "weight" DECIMAL(5,2),
    "hba1c" DECIMAL(5,2),
    "ketones" DECIMAL(5,2),
    "systolic_pressure" SMALLINT,
    "diastolic_pressure" SMALLINT,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "diabetes_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insulin_flow_entries" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "flow" DECIMAL(6,2),
    "hour" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insulin_flow_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insulin_flow_device_data" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "device_id" VARCHAR(50) NOT NULL,
    "date" DATE NOT NULL,
    "flow" DECIMAL(6,2),
    "hour" JSONB,
    "events" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insulin_flow_device_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pump_events" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pump_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "average_data" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "period_type" "PeriodType" NOT NULL,
    "meal_type" VARCHAR(20) NOT NULL,
    "glycemia" DECIMAL(4,2),
    "color" VARCHAR(10),
    "glycemia_1h" DECIMAL(4,2),
    "color_1h" VARCHAR(10),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "average_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_devices" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "brand" VARCHAR(100),
    "name" VARCHAR(100),
    "model" VARCHAR(100),
    "sn" VARCHAR(100),
    "date" TIMESTAMPTZ,
    "type" VARCHAR(50),
    "category" "DeviceCategory",
    "connection_types" TEXT[],
    "model_identifier" VARCHAR(100),

    CONSTRAINT "patient_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_data_sync" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "device_uid" VARCHAR(100) NOT NULL,
    "sequence_num" BIGINT NOT NULL DEFAULT 0,
    "last_sync_date" TIMESTAMPTZ,

    CONSTRAINT "device_data_sync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "healthcare_services" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "establishment" VARCHAR(255),
    "address_line1" VARCHAR(255),
    "address_line2" VARCHAR(255),
    "postal_code" VARCHAR(10),
    "city" VARCHAR(100),
    "country" CHAR(2),
    "phone" VARCHAR(30),
    "email" VARCHAR(255),
    "website" VARCHAR(500),
    "opening_hours" JSONB,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capacity" INTEGER,
    "manager_id" INTEGER,
    "no_videos" BOOLEAN NOT NULL DEFAULT false,
    "no_food" BOOLEAN NOT NULL DEFAULT false,
    "logo" VARCHAR(500),
    "type" "ServiceType" NOT NULL DEFAULT 'clinic',
    "license_number" VARCHAR(11),

    CONSTRAINT "healthcare_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "healthcare_members" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "name" VARCHAR(255) NOT NULL,
    "service_id" INTEGER,

    CONSTRAINT "healthcare_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_services" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "service_id" INTEGER NOT NULL,
    "member_id" INTEGER,
    "wait" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_referent" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "pro_id" INTEGER,
    "service_id" INTEGER,

    CONSTRAINT "patient_referent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_documents" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "date" TIMESTAMPTZ NOT NULL,
    "member_id" INTEGER,
    "patient_share" BOOLEAN NOT NULL DEFAULT true,
    "is_author_psad" BOOLEAN NOT NULL DEFAULT false,
    "share_with_psad" BOOLEAN NOT NULL DEFAULT false,
    "category" "DocumentCategory",
    "mime_type" VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
    "file_url" VARCHAR(500),
    "file_size" BIGINT,
    "is_downloaded" BOOLEAN NOT NULL DEFAULT false,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" SERIAL NOT NULL,
    "patient_id" INTEGER NOT NULL,
    "type" VARCHAR(50),
    "date" DATE NOT NULL,
    "hour" TIME,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "call_back_delay" INTEGER,
    "display_announcement" BOOLEAN NOT NULL DEFAULT true,
    "display_show_button" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_configurations" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "column_count" INTEGER NOT NULL DEFAULT 4,
    "name" VARCHAR(100),
    "last_modified" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_widgets" (
    "id" TEXT NOT NULL,
    "config_id" INTEGER NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "position_row" INTEGER NOT NULL,
    "position_column" INTEGER NOT NULL,
    "span_columns" INTEGER NOT NULL DEFAULT 1,
    "span_rows" INTEGER NOT NULL DEFAULT 1,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "custom_title" VARCHAR(100),

    CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_definitions" (
    "id" SERIAL NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "unit_code" INTEGER NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "title" VARCHAR(50) NOT NULL,
    "factor" DECIMAL(10,6),
    "factor_base" DECIMAL(10,6),
    "precision" INTEGER,

    CONSTRAINT "unit_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_device_registrations" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "push_token" VARCHAR(500) NOT NULL,
    "device_name" VARCHAR(100),
    "device_model" VARCHAR(50),
    "os_version" VARCHAR(20),
    "app_version" VARCHAR(20),
    "app_bundle_id" VARCHAR(100),
    "endpoint_arn" VARCHAR(500),
    "locale" VARCHAR(10) DEFAULT 'fr',
    "push_timezone" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_sandbox" BOOLEAN NOT NULL DEFAULT false,
    "last_used_at" TIMESTAMPTZ,
    "registered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "unregistered_at" TIMESTAMPTZ,

    CONSTRAINT "push_device_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_notification_templates" (
    "id" VARCHAR(50) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "title_fr" VARCHAR(200) NOT NULL,
    "title_en" VARCHAR(200) NOT NULL,
    "title_ar" VARCHAR(200) NOT NULL,
    "body_fr" TEXT NOT NULL,
    "body_en" TEXT NOT NULL,
    "body_ar" TEXT NOT NULL,
    "ios_sound" VARCHAR(50) DEFAULT 'default',
    "ios_badge_increment" INTEGER DEFAULT 1,
    "ios_category" VARCHAR(50),
    "ios_interruption_level" "IosInterruptionLevel" DEFAULT 'active',
    "android_channel_id" VARCHAR(50),
    "android_priority" "AndroidPriority" DEFAULT 'high',
    "android_icon" VARCHAR(50),
    "data_payload" JSONB,
    "ttl_seconds" INTEGER DEFAULT 86400,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "push_notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_notifications_log" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "registration_id" TEXT,
    "template_id" VARCHAR(50),
    "platform" "PushPlatform" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "data_payload" JSONB,
    "status" "PushNotifStatus" NOT NULL DEFAULT 'pending',
    "provider_message_id" VARCHAR(200),
    "error_code" VARCHAR(50),
    "error_message" TEXT,
    "sent_at" TIMESTAMPTZ,
    "delivered_at" TIMESTAMPTZ,
    "opened_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_notifications_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_scheduled_notifications" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "template_id" VARCHAR(50) NOT NULL,
    "schedule_type" "ScheduleType" NOT NULL,
    "scheduled_at" TIMESTAMPTZ,
    "cron_expression" VARCHAR(50),
    "cron_timezone" VARCHAR(50) NOT NULL DEFAULT 'Europe/Paris',
    "template_variables" JSONB,
    "platforms" "PushPlatform"[] DEFAULT ARRAY['ios', 'android', 'web']::"PushPlatform"[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_triggered_at" TIMESTAMPTZ,
    "next_trigger_at" TIMESTAMPTZ,
    "max_occurrences" INTEGER,
    "occurrences_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "push_scheduled_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER,
    "action" VARCHAR(30) NOT NULL,
    "resource" VARCHAR(30) NOT NULL,
    "resource_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "request_id" VARCHAR(64),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mydiabby_credentials" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "mydiabby_uid" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "token" TEXT,
    "refresh_token" TEXT,
    "token_expires_at" TIMESTAMPTZ,
    "last_sync_at" TIMESTAMPTZ,
    "last_sequence_num" TEXT,
    "consecutive_errors" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "mydiabby_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mydiabby_sync_logs" (
    "id" SERIAL NOT NULL,
    "credential_id" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "cgm_count" INTEGER NOT NULL DEFAULT 0,
    "glycemia_count" INTEGER NOT NULL DEFAULT 0,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "profile_updated" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mydiabby_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bdpm_specialties" (
    "id" SERIAL NOT NULL,
    "code_cis" VARCHAR(8) NOT NULL,
    "denomination" TEXT NOT NULL,
    "forme_pharma" VARCHAR(200) NOT NULL,
    "voies_admin" VARCHAR(500) NOT NULL,
    "statut_amm" VARCHAR(100) NOT NULL,
    "procedure_amm" VARCHAR(100),
    "etat_comm" VARCHAR(100),
    "date_amm" DATE,
    "titulaires" TEXT,
    "surveillance" BOOLEAN NOT NULL DEFAULT false,
    "atc_code" VARCHAR(10),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bdpm_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bdpm_presentations" (
    "id" SERIAL NOT NULL,
    "code_cis" VARCHAR(8) NOT NULL,
    "code_cip7" VARCHAR(7),
    "code_cip13" VARCHAR(13) NOT NULL,
    "libelle" TEXT NOT NULL,
    "statut_admin" VARCHAR(100),
    "etat_comm" VARCHAR(100),
    "taux_remb" VARCHAR(20),
    "prix" DECIMAL(10,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bdpm_presentations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bdpm_compositions" (
    "id" SERIAL NOT NULL,
    "code_cis" VARCHAR(8) NOT NULL,
    "substance" VARCHAR(500) NOT NULL,
    "code_substance" VARCHAR(20),
    "dosage" VARCHAR(200),
    "reference" VARCHAR(200),
    "nature" VARCHAR(5) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bdpm_compositions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atc_classifications" (
    "code" VARCHAR(10) NOT NULL,
    "level" SMALLINT NOT NULL,
    "label_fr" VARCHAR(300) NOT NULL,
    "label_en" VARCHAR(300),
    "parent_code" VARCHAR(10),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atc_classifications_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "bdpm_import_logs" (
    "id" SERIAL NOT NULL,
    "version" VARCHAR(50) NOT NULL,
    "specialty_count" INTEGER NOT NULL,
    "present_count" INTEGER NOT NULL,
    "composition_count" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "error_message" TEXT,
    "duration_ms" INTEGER NOT NULL,
    "antivirus_passed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bdpm_import_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_logs" (
    "id" SERIAL NOT NULL,
    "backup_ref" VARCHAR(64) NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'pending',
    "location" VARCHAR(500),
    "size_bytes" BIGINT,
    "duration_ms" INTEGER,
    "triggered_by" INTEGER,
    "error_message" VARCHAR(500),
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "backup_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_hmac_key" ON "users"("email_hmac");

-- CreateIndex
CREATE INDEX "users_created_at_idx" ON "users"("created_at");

-- CreateIndex
CREATE INDEX "users_firstname_hmac_lastname_hmac_idx" ON "users"("firstname_hmac", "lastname_hmac");

-- CreateIndex
CREATE INDEX "users_status_role_idx" ON "users"("status", "role");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "user_unit_preferences_user_id_key" ON "user_unit_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_preferences_user_id_key" ON "user_notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_privacy_settings_user_id_key" ON "user_privacy_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_day_moments_user_id_type_key" ON "user_day_moments"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ui_state_save_user_id_key_key" ON "ui_state_save"("user_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "patients_user_id_key" ON "patients"("user_id");

-- CreateIndex
CREATE INDEX "patients_deleted_at_idx" ON "patients"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_medical_data_patient_id_key" ON "patient_medical_data"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_administrative_patient_id_key" ON "patient_administrative"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "cgm_objectives_patient_id_key" ON "cgm_objectives"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "annex_objectives_patient_id_key" ON "annex_objectives"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "alert_threshold_configs_patient_id_key" ON "alert_threshold_configs"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "ketone_thresholds_patient_id_key" ON "ketone_thresholds"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "hypo_treatment_protocols_patient_id_key" ON "hypo_treatment_protocols"("patient_id");

-- CreateIndex
CREATE INDEX "emergency_alerts_patient_id_status_triggered_at_idx" ON "emergency_alerts"("patient_id", "status", "triggered_at");

-- CreateIndex
CREATE INDEX "emergency_alerts_patient_id_alert_type_status_idx" ON "emergency_alerts"("patient_id", "alert_type", "status");

-- CreateIndex
CREATE INDEX "emergency_alerts_patient_id_severity_triggered_at_idx" ON "emergency_alerts"("patient_id", "severity", "triggered_at");

-- CreateIndex
CREATE INDEX "emergency_alerts_status_severity_triggered_at_idx" ON "emergency_alerts"("status", "severity", "triggered_at");

-- CreateIndex
CREATE INDEX "emergency_alerts_alert_type_triggered_at_idx" ON "emergency_alerts"("alert_type", "triggered_at");

-- CreateIndex
CREATE INDEX "emergency_alert_actions_alert_id_created_at_idx" ON "emergency_alert_actions"("alert_id", "created_at");

-- CreateIndex
CREATE INDEX "emergency_alert_actions_performed_by_created_at_idx" ON "emergency_alert_actions"("performed_by", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "insulin_catalog_display_name_key" ON "insulin_catalog"("display_name");

-- CreateIndex
CREATE INDEX "insulin_catalog_is_active_idx" ON "insulin_catalog"("is_active");

-- CreateIndex
CREATE INDEX "patient_insulins_patient_id_is_active_idx" ON "patient_insulins"("patient_id", "is_active");

-- CreateIndex
CREATE INDEX "patient_insulins_patient_id_insulin_catalog_id_idx" ON "patient_insulins"("patient_id", "insulin_catalog_id");

-- CreateIndex
CREATE INDEX "patient_insulins_patient_id_start_date_idx" ON "patient_insulins"("patient_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "insulin_therapy_settings_patient_id_key" ON "insulin_therapy_settings"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "iob_settings_settings_id_key" ON "iob_settings"("settings_id");

-- CreateIndex
CREATE UNIQUE INDEX "extended_bolus_settings_settings_id_key" ON "extended_bolus_settings"("settings_id");

-- CreateIndex
CREATE INDEX "insulin_sensitivity_factors_settings_id_start_hour_idx" ON "insulin_sensitivity_factors"("settings_id", "start_hour");

-- CreateIndex
CREATE INDEX "carb_ratios_settings_id_start_hour_idx" ON "carb_ratios"("settings_id", "start_hour");

-- CreateIndex
CREATE UNIQUE INDEX "basal_configurations_settings_id_key" ON "basal_configurations"("settings_id");

-- CreateIndex
CREATE INDEX "bolus_calculation_logs_patient_id_calculated_at_idx" ON "bolus_calculation_logs"("patient_id", "calculated_at");

-- CreateIndex
CREATE INDEX "adjustment_proposals_patient_id_status_created_at_idx" ON "adjustment_proposals"("patient_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "cgm_entries_patient_id_timestamp_idx" ON "cgm_entries"("patient_id", "timestamp");

-- CreateIndex
CREATE INDEX "cgm_entries_timestamp_idx" ON "cgm_entries"("timestamp");

-- CreateIndex
CREATE INDEX "glycemia_entries_patient_id_date_time_idx" ON "glycemia_entries"("patient_id", "date", "time");

-- CreateIndex
CREATE INDEX "diabetes_events_patient_id_event_date_idx" ON "diabetes_events"("patient_id", "event_date");

-- CreateIndex
CREATE INDEX "insulin_flow_entries_patient_id_date_idx" ON "insulin_flow_entries"("patient_id", "date");

-- CreateIndex
CREATE INDEX "pump_events_patient_id_timestamp_idx" ON "pump_events"("patient_id", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "average_data_patient_id_period_type_meal_type_key" ON "average_data"("patient_id", "period_type", "meal_type");

-- CreateIndex
CREATE UNIQUE INDEX "device_data_sync_user_id_device_uid_key" ON "device_data_sync"("user_id", "device_uid");

-- CreateIndex
CREATE INDEX "healthcare_services_type_idx" ON "healthcare_services"("type");

-- CreateIndex
CREATE INDEX "healthcare_services_manager_id_idx" ON "healthcare_services"("manager_id");

-- CreateIndex
CREATE INDEX "healthcare_services_specialties_idx" ON "healthcare_services" USING GIN ("specialties");

-- CreateIndex
CREATE UNIQUE INDEX "healthcare_services_name_establishment_key" ON "healthcare_services"("name", "establishment");

-- CreateIndex
CREATE UNIQUE INDEX "healthcare_members_user_id_key" ON "healthcare_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "healthcare_members_name_service_id_key" ON "healthcare_members"("name", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_services_patient_id_service_id_key" ON "patient_services"("patient_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "patient_referent_patient_id_key" ON "patient_referent"("patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_configurations_user_id_key" ON "dashboard_configurations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_definitions_unit_code_key" ON "unit_definitions"("unit_code");

-- CreateIndex
CREATE UNIQUE INDEX "push_device_registrations_push_token_key" ON "push_device_registrations"("push_token");

-- CreateIndex
CREATE INDEX "push_device_registrations_user_id_is_active_idx" ON "push_device_registrations"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "push_device_registrations_platform_is_active_idx" ON "push_device_registrations"("platform", "is_active");

-- CreateIndex
CREATE INDEX "push_notification_templates_category_idx" ON "push_notification_templates"("category");

-- CreateIndex
CREATE INDEX "push_notifications_log_user_id_idx" ON "push_notifications_log"("user_id");

-- CreateIndex
CREATE INDEX "push_notifications_log_status_idx" ON "push_notifications_log"("status");

-- CreateIndex
CREATE INDEX "push_notifications_log_created_at_idx" ON "push_notifications_log"("created_at");

-- CreateIndex
CREATE INDEX "push_notifications_log_template_id_status_idx" ON "push_notifications_log"("template_id", "status");

-- CreateIndex
CREATE INDEX "push_scheduled_notifications_user_id_idx" ON "push_scheduled_notifications"("user_id");

-- CreateIndex
CREATE INDEX "push_scheduled_notifications_next_trigger_at_is_active_idx" ON "push_scheduled_notifications"("next_trigger_at", "is_active");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_resource_id_created_at_idx" ON "audit_logs"("resource", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "mydiabby_credentials_user_id_key" ON "mydiabby_credentials"("user_id");

-- CreateIndex
CREATE INDEX "mydiabby_sync_logs_credential_id_created_at_idx" ON "mydiabby_sync_logs"("credential_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bdpm_specialties_code_cis_key" ON "bdpm_specialties"("code_cis");

-- CreateIndex
CREATE INDEX "bdpm_specialties_denomination_idx" ON "bdpm_specialties" USING GIN ("denomination" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "bdpm_specialties_atc_code_idx" ON "bdpm_specialties"("atc_code");

-- CreateIndex
CREATE INDEX "bdpm_specialties_statut_amm_idx" ON "bdpm_specialties"("statut_amm");

-- CreateIndex
CREATE UNIQUE INDEX "bdpm_presentations_code_cip13_key" ON "bdpm_presentations"("code_cip13");

-- CreateIndex
CREATE INDEX "bdpm_presentations_code_cis_idx" ON "bdpm_presentations"("code_cis");

-- CreateIndex
CREATE INDEX "bdpm_compositions_code_cis_idx" ON "bdpm_compositions"("code_cis");

-- CreateIndex
CREATE INDEX "bdpm_compositions_substance_idx" ON "bdpm_compositions" USING GIN ("substance" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "atc_classifications_parent_code_idx" ON "atc_classifications"("parent_code");

-- CreateIndex
CREATE INDEX "atc_classifications_label_fr_idx" ON "atc_classifications" USING GIN ("label_fr" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "backup_logs_backup_ref_key" ON "backup_logs"("backup_ref");

-- CreateIndex
CREATE INDEX "backup_logs_status_started_at_idx" ON "backup_logs"("status", "started_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_status_changed_by_fkey" FOREIGN KEY ("status_changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_unit_preferences" ADD CONSTRAINT "user_unit_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_privacy_settings" ADD CONSTRAINT "user_privacy_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_day_moments" ADD CONSTRAINT "user_day_moments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ui_state_save" ADD CONSTRAINT "ui_state_save_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medical_data" ADD CONSTRAINT "patient_medical_data_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_administrative" ADD CONSTRAINT "patient_administrative_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_pregnancy" ADD CONSTRAINT "patient_pregnancy_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "glycemia_objectives" ADD CONSTRAINT "glycemia_objectives_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cgm_objectives" ADD CONSTRAINT "cgm_objectives_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annex_objectives" ADD CONSTRAINT "annex_objectives_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_threshold_configs" ADD CONSTRAINT "alert_threshold_configs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ketone_thresholds" ADD CONSTRAINT "ketone_thresholds_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hypo_treatment_protocols" ADD CONSTRAINT "hypo_treatment_protocols_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_alert_actions" ADD CONSTRAINT "emergency_alert_actions_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "emergency_alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_alert_actions" ADD CONSTRAINT "emergency_alert_actions_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basal_flow_schedules" ADD CONSTRAINT "basal_flow_schedules_treatment_id_fkey" FOREIGN KEY ("treatment_id") REFERENCES "treatments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_insulins" ADD CONSTRAINT "patient_insulins_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_insulins" ADD CONSTRAINT "patient_insulins_insulin_catalog_id_fkey" FOREIGN KEY ("insulin_catalog_id") REFERENCES "insulin_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_insulins" ADD CONSTRAINT "patient_insulins_prescribed_by_fkey" FOREIGN KEY ("prescribed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insulin_therapy_settings" ADD CONSTRAINT "insulin_therapy_settings_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insulin_therapy_settings" ADD CONSTRAINT "insulin_therapy_settings_bolus_insulin_id_fkey" FOREIGN KEY ("bolus_insulin_id") REFERENCES "patient_insulins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insulin_therapy_settings" ADD CONSTRAINT "insulin_therapy_settings_basal_insulin_id_fkey" FOREIGN KEY ("basal_insulin_id") REFERENCES "patient_insulins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "glucose_targets" ADD CONSTRAINT "glucose_targets_settings_id_fkey" FOREIGN KEY ("settings_id") REFERENCES "insulin_therapy_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "iob_settings" ADD CONSTRAINT "iob_settings_settings_id_fkey" FOREIGN KEY ("settings_id") REFERENCES "insulin_therapy_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extended_bolus_settings" ADD CONSTRAINT "extended_bolus_settings_settings_id_fkey" FOREIGN KEY ("settings_id") REFERENCES "insulin_therapy_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insulin_sensitivity_factors" ADD CONSTRAINT "insulin_sensitivity_factors_settings_id_fkey" FOREIGN KEY ("settings_id") REFERENCES "insulin_therapy_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carb_ratios" ADD CONSTRAINT "carb_ratios_settings_id_fkey" FOREIGN KEY ("settings_id") REFERENCES "insulin_therapy_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basal_configurations" ADD CONSTRAINT "basal_configurations_settings_id_fkey" FOREIGN KEY ("settings_id") REFERENCES "insulin_therapy_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pump_basal_slots" ADD CONSTRAINT "pump_basal_slots_basal_config_id_fkey" FOREIGN KEY ("basal_config_id") REFERENCES "basal_configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bolus_calculation_logs" ADD CONSTRAINT "bolus_calculation_logs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_proposals" ADD CONSTRAINT "adjustment_proposals_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_proposals" ADD CONSTRAINT "adjustment_proposals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_proposals" ADD CONSTRAINT "adjustment_proposals_pump_basal_slot_id_fkey" FOREIGN KEY ("pump_basal_slot_id") REFERENCES "pump_basal_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cgm_entries" ADD CONSTRAINT "cgm_entries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "glycemia_entries" ADD CONSTRAINT "glycemia_entries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diabetes_events" ADD CONSTRAINT "diabetes_events_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insulin_flow_entries" ADD CONSTRAINT "insulin_flow_entries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insulin_flow_device_data" ADD CONSTRAINT "insulin_flow_device_data_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pump_events" ADD CONSTRAINT "pump_events_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "average_data" ADD CONSTRAINT "average_data_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_devices" ADD CONSTRAINT "patient_devices_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_data_sync" ADD CONSTRAINT "device_data_sync_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "healthcare_services" ADD CONSTRAINT "healthcare_services_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "healthcare_members" ADD CONSTRAINT "healthcare_members_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "healthcare_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_services" ADD CONSTRAINT "patient_services_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_services" ADD CONSTRAINT "patient_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "healthcare_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_services" ADD CONSTRAINT "patient_services_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "healthcare_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_referent" ADD CONSTRAINT "patient_referent_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_referent" ADD CONSTRAINT "patient_referent_pro_id_fkey" FOREIGN KEY ("pro_id") REFERENCES "healthcare_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_referent" ADD CONSTRAINT "patient_referent_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "healthcare_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_documents" ADD CONSTRAINT "medical_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_documents" ADD CONSTRAINT "medical_documents_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "healthcare_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_configurations" ADD CONSTRAINT "dashboard_configurations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_config_id_fkey" FOREIGN KEY ("config_id") REFERENCES "dashboard_configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_device_registrations" ADD CONSTRAINT "push_device_registrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_notifications_log" ADD CONSTRAINT "push_notifications_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_notifications_log" ADD CONSTRAINT "push_notifications_log_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "push_device_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_notifications_log" ADD CONSTRAINT "push_notifications_log_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "push_notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_scheduled_notifications" ADD CONSTRAINT "push_scheduled_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_scheduled_notifications" ADD CONSTRAINT "push_scheduled_notifications_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "push_notification_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mydiabby_credentials" ADD CONSTRAINT "mydiabby_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mydiabby_sync_logs" ADD CONSTRAINT "mydiabby_sync_logs_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "mydiabby_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bdpm_presentations" ADD CONSTRAINT "bdpm_presentations_code_cis_fkey" FOREIGN KEY ("code_cis") REFERENCES "bdpm_specialties"("code_cis") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bdpm_compositions" ADD CONSTRAINT "bdpm_compositions_code_cis_fkey" FOREIGN KEY ("code_cis") REFERENCES "bdpm_specialties"("code_cis") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_logs" ADD CONSTRAINT "backup_logs_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
