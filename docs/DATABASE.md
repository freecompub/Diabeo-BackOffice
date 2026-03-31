# Schéma de base de données — Diabeo Backoffice

Documentation complète du schéma Prisma (48 tables × 11 domaines) implémenté en Phase 0.

---

## Vue d'ensemble

**48 tables** organisées en **11 domaines métier** :

1. Utilisateur & Authentification (7 tables)
2. Patient & Données médicales (8 tables)
3. Configuration Insulinothérapie (8 tables)
4. Glycémie & CGM (5 tables)
5. Événements & Activités (3 tables)
6. Propositions d'Ajustement (1 table)
7. Appareils & Synchronisation (4 tables)
8. Équipe médicale (4 tables)
9. Documents & Rendez-vous (3 tables)
10. Notifications Push (4 tables)
11. Configuration UI (3 tables)
12. Audit (1 table spéciale)

---

## Énums (21 au total)

### Rôles utilisateurs

```typescript
enum Role {
  ADMIN      // Gestion complète : users, audit, configuration
  DOCTOR     // Patients de son portefeuille, validation configs
  NURSE      // Consultation patients, création configs (sans validation)
  VIEWER     // Lecture seule, patients uniquement
}
```

### Pathologies

```typescript
enum Pathology {
  DT1          // Diabète Type 1 (insulinodépendant)
  DT2          // Diabète Type 2
  GD           // Gestationnel
}
```

### Autres énums importants

| Enum | Valeurs |
|------|---------|
| `Sex` | M, F, X |
| `Language` | fr, en, ar |
| `DayMomentType` | morning, noon, evening, night, custom |
| `InsulinDeliveryMethod` | pump, manual |
| `TreatmentType` | fgm, pump, insulin_pump, glp1 |
| `BasalConfigType` | pump, single_injection, split_injection |
| `GlucoseTargetPreset` | standard, tight, pediatric, elderly, custom |
| `AdjustableParameter` | basalRate, insulinSensitivityFactor, insulinToCarbRatio |
| `AdjustmentReason` | basalTooLow, basalTooHigh, isfTooLow, isfTooHigh, icrTooLow, icrTooHigh, ... |
| `ConfidenceLevel` | low, medium, high |
| `ProposalStatus` | pending, accepted, rejected, expired |
| `DeviceCategory` | glucometer, cgm, insulinPump, insulinPen, healthApp |
| `DocumentCategory` | general, forDoctor, personal, prescription, labResults, other |
| `PushPlatform` | ios, android, web |
| `PushNotifStatus` | pending, sent, delivered, failed, expired |
| `ScheduleType` | once, daily, weekly, custom_cron |
| `IosInterruptionLevel` | passive, active, time_sensitive, critical |
| `DiabetesEventType` | glycemia, insulinMeal, physicalActivity, context, occasional |
| `AndroidPriority` | normal, high |

---

## Domaine 1 : Utilisateur & Authentification (7 tables)

### User

Table centrale — utilisateurs patients et professionnels.

| Colonne | Type | Nullable | Contraintes | Notes |
|---------|------|----------|-------------|-------|
| `id` | INT | NO | PK, autoincrement | |
| `email` | STRING | NO | | **Chiffré** en production |
| `emailHmac` | STRING | NO | UNIQUE | HMAC-SHA256(email, secret) — lookup rapide |
| `passwordHash` | STRING | NO | | Bcrypt (phase 1) |
| `title` | STRING | YES | | M., Mme, Dr, Prof |
| `firstname` | STRING | YES | | **Chiffré** |
| `firstnames` | STRING | YES | | Seconds prénoms **chiffrés** |
| `usedFirstname` | STRING | YES | | Prénom d'usage **chiffré** |
| `lastname` | STRING | YES | | **Chiffré** |
| `usedLastname` | STRING | YES | | Nom d'usage **chiffré** |
| `birthday` | DATE | YES | | **Chiffré** |
| `sex` | ENUM(Sex) | YES | | M, F, X |
| `codeBirthPlace` | STRING | YES | | Code INSEE **chiffré** |
| `timezone` | STRING | YES | DEFAULT 'Europe/Paris' | IANA timezone |
| `phone` | STRING | YES | | **Chiffré** |
| `address1` | STRING | YES | | **Chiffré** |
| `address2` | STRING | YES | | **Chiffré** |
| `cp` | STRING | YES | | Code postal **chiffré** |
| `city` | STRING | YES | | **Chiffré** |
| `country` | CHAR(2) | YES | | ISO 3166-1 alpha-2 |
| `pic` | STRING | YES | | Photo profil (OVH Object Storage) |
| `language` | ENUM(Language) | YES | DEFAULT 'fr' | fr, en, ar |
| `role` | ENUM(Role) | NO | DEFAULT 'VIEWER' | ADMIN, DOCTOR, NURSE, VIEWER |
| `mfaSecret` | STRING | YES | | TOTP secret (phase 1) |
| `mfaEnabled` | BOOLEAN | NO | DEFAULT false | |
| `hasSignedTerms` | BOOLEAN | NO | DEFAULT false | CGU signées |
| `profileComplete` | BOOLEAN | NO | DEFAULT false | Onboarding complété |
| `needDataPolicyUpdate` | BOOLEAN | NO | DEFAULT false | |
| `dataPolicyUpdate` | DATETIME | YES | | |
| `needPasswordUpdate` | BOOLEAN | NO | DEFAULT false | |
| `needOnboarding` | BOOLEAN | NO | DEFAULT false | |
| `debug` | BOOLEAN | NO | DEFAULT false | Mode debug actif |
| `nirpp` | STRING | YES | | Numéro sécu **TRES SENSIBLE** |
| `nirppType` | STRING | YES | | nir, nia, nir_key |
| `nirppPolicyholder` | STRING | YES | | NIR assuré si ayant-droit **chiffré** |
| `nirppPolicyholderType` | STRING | YES | | |
| `oid` | STRING | YES | | Organisation ID (interne) |
| `ins` | STRING | YES | | Identité Nationale Santé **chiffré** |
| `intercomHash` | STRING | YES | | Messagerie sécurisée hash (interne) |
| `deploymentKey` | STRING | YES | | CodePush key (interne) |
| `pro` | STRING | YES | | Profil pro (interne) |
| `displayModalTlsMutual` | BOOLEAN | NO | DEFAULT false | |
| `displayModalTlsMandatory` | BOOLEAN | NO | DEFAULT false | |
| `createdAt` | DATETIME | NO | DEFAULT NOW() | |
| `updatedAt` | DATETIME | NO | DEFAULT NOW() | |

**Relations** :
- `patient` (1:1) — si utilisateur patient
- `unitPreferences` (1:1) — préférences unités
- `notifPreferences` (1:1) — notifications
- `privacySettings` (1:1) — RGPD
- `dayMoments` (1:N) — moments du jour
- `sessions` (1:N) — NextAuth sessions
- `accounts` (1:N) — OAuth accounts
- `auditLogs` (1:N) — actions utilisateur

**Index** :
- `emailHmac` (UNIQUE) — lookup email
- `createdAt` — timeline

**Champs chiffrés** (AES-256-GCM base64) :
- email, firstname, firstnames, usedFirstname, lastname, usedLastname, birthday
- codeBirthPlace, phone, address1, address2, cp, city
- nirpp, nirppPolicyholder, ins

---

### Account, Session, VerificationToken

NextAuth v5 tables standards — pas de modification.

| Table | Usage | Notes |
|-------|-------|-------|
| `Account` | OAuth providers | Tokens d'accès externes |
| `Session` | Sessions JWT/DB | Créé par NextAuth |
| `VerificationToken` | Email verification | (phase 1) |

---

### UserUnitPreferences

Préférences personnelles d'unités de mesure.

| Colonne | Type | Default | Notes |
|---------|------|---------|-------|
| `id` | INT | — | PK |
| `userId` | INT | — | FK → User (UNIQUE) |
| `unitGlycemia` | INT | 5 | 3:g/L, 4:mg/dL, 5:mmol/L |
| `unitWeight` | INT | 6 | 6:kg, 7:lbs |
| `unitSize` | INT | 8 | 8:cm, 9:ft |
| `unitCarb` | INT | 2 | 1:CP, 2:g |
| `unitHba1c` | INT | 10 | 10:%, 11:mmol/mol |
| `unitCarbExchangeNb` | INT | 15 | g par portion |
| `unitKetones` | INT | 12 | 12:mmol/L, 13:mg/dL |
| `unitBloodPressure` | INT | 14 | 14:mmHg |

---

### UserNotifPreferences, UserPrivacySettings

Notifications et consentements RGPD.

```typescript
UserNotifPreferences {
  notifMessageMail: boolean      // Mail pour messages
  notifDocumentMail: boolean     // Mail pour documents
  glycemiaReminders: boolean     // Rappels glycémie
  glycemiaReminderTimes: JSON    // Array d'heures [HH:MM]
  insulinReminders: boolean      // Rappels insuline
  insulinReminderTimes: JSON     // Array d'heures [HH:MM]
  medicalAppointments: boolean   // Rappels RDV
  autoExport: boolean            // Export auto
  autoExportFrequency: INT       // Jours
}

UserPrivacySettings {
  shareWithResearchers: boolean  // Partage recherche
  shareWithProviders: boolean    // Partage équipe soignante
  analyticsEnabled: boolean      // Analytics activé
  gdprConsent: boolean           // Consentement RGPD
  consentDate: DATETIME          // Date consentement
}
```

---

## Domaine 2 : Patient & Données médicales (8 tables)

### Patient

Représente un patient — lien 1:1 avec un User.

| Colonne | Type | Nullable | Notes |
|---------|------|----------|-------|
| `id` | INT | NO | PK |
| `userId` | INT | NO | FK → User (UNIQUE) |
| `pathology` | ENUM(Pathology) | NO | DT1, DT2, GD |
| `deletedAt` | DATETIME | YES | **Soft delete RGPD** |
| `createdAt` | DATETIME | NO | |
| `updatedAt` | DATETIME | NO | |

**Queryable avec** : `WHERE deletedAt IS NULL`

---

### PatientMedicalData

Antécédents et comorbidités.

```typescript
{
  patientId: INT (FK, UNIQUE)
  dt1: BOOLEAN              // Antécédent DT1
  size: FLOAT               // Taille en cm
  yearDiag: INT             // Année diagnostic
  insulin: BOOLEAN          // Traitement insuline actuel
  insulinYear: INT          // Année début insuline
  insulinPump: BOOLEAN      // Pompe actuelle
  tabac: BOOLEAN            // Tabagisme
  alcool: BOOLEAN           // Consommation alcool
  riskWeight: BOOLEAN       // Surpoids/obésité
  riskCardio: BOOLEAN       // Risque cardiovasculaire
  createdAt: DATETIME
  updatedAt: DATETIME
}
```

---

### PatientAdministrative, PatientPregnancy, GlycemiaObjective, CgmObjective, AnnexObjective, Treatment

Données administratives, grossesse (si GD), objectifs glycémiques, traitements.

```typescript
PatientAdministrative {
  patientId: INT (FK, UNIQUE)
  refMutuelle: STRING        // Référence mutuelle
  refAssoc: STRING           // Référence association
  // ... autres infos administratives
}

PatientPregnancy {  // Seulement si pathology == GD
  patientId: INT (FK)
  pregnancyStartDate: DATE
  expectedDeliveryDate: DATE
  glycemiaTargets: JSON      // Cibles enceinte
}

CgmObjective {
  patientId: INT (FK, UNIQUE)
  veryLow: FLOAT             // Temps TIR < 0.54 g/L (%)
  low: FLOAT                 // Temps 0.54-0.70
  ok: FLOAT                  // Temps 0.70-1.80 (cible)
  high: FLOAT                // Temps 1.80-2.50
  titrLow: FLOAT             // Titration basse
  titrHigh: FLOAT            // Titration haute
}

AnnexObjective {
  patientId: INT (FK, UNIQUE)
  objectiveHba1c: FLOAT      // HbA1c cible (%)
  objectiveWalk: INT         // Marche quotidienne (min)
}

Treatment {
  patientId: INT (FK)
  type: ENUM(TreatmentType)  // fgm, pump, glp1
  brand: STRING              // Marque
  startDate: DATE
  endDate: DATE              // NULL si actuel
}
```

---

## Domaine 3 : Configuration Insulinothérapie (8 tables)

### InsulinTherapySettings

Configuration racine de l'insulinothérapie par patient.

| Colonne | Type | Nullable | Notes |
|---------|------|----------|-------|
| `id` | INT | NO | PK |
| `patientId` | INT | NO | FK (UNIQUE) | 1:1 |
| `bolusInsulinBrand` | STRING | YES | Ex: "novorapid", "humalog" |
| `basalInsulinBrand` | STRING | YES | Ex: "lantus", "levemir" |
| `insulinActionDuration` | FLOAT | YES | Heures (ex: 4.0) |
| `deliveryMethod` | ENUM | NO | pump, manual |
| `createdAt` | DATETIME | NO | |
| `updatedAt` | DATETIME | NO | |

**Relations** :
- `glucoseTargets` (1:N) — Cibles glycémiques horaires
- `iobSettings` (1:1) — IOB (Insulin On Board)
- `extendedBolusSettings` (1:1) — Bolus étendu
- `sensitivityFactors` (1:N) — ISF par slot horaire
- `carbRatios` (1:N) — ICR par slot horaire
- `basalConfiguration` (1:1) — Profil basal

---

### GlucoseTarget

Cibles glycémiques horaires ou presets.

```typescript
{
  id: INT (PK)
  settingsId: INT (FK)
  targetGlucose: INT         // mg/dL (ex: 120)
  targetRangeLower: FLOAT    // g/L (ex: 0.70)
  targetRangeUpper: FLOAT    // g/L (ex: 1.80)
  preset: ENUM(GlucoseTargetPreset)  // standard, tight, pediatric, elderly, custom
  isActive: BOOLEAN          // TRUE : actuellement utilisée
  createdAt: DATETIME
  updatedAt: DATETIME
}
```

---

### InsulinSensitivityFactor (ISF)

Facteur de sensibilité insuline par créneau horaire.

**Schema réel (seed)** :
```typescript
{
  settingsId: INT (FK)
  startHour: INT             // 0-23 (ex: 6)
  endHour: INT               // 0-23 (ex: 12)
  startTime: TIME            // HH:MM:SS (ex: 06:00:00)
  endTime: TIME              // HH:MM:SS (ex: 12:00:00)
  sensitivityFactorGl: FLOAT // g/L/U (ex: 0.30) — 1 U baisse glycémie de 0.30 g/L
  sensitivityFactorMgdl: FLOAT // mg/dL/U (ex: 30) — idem en mg/dL
  insulinActionMin: FLOAT    // Minimum durée action (h) — TODO Phase 1
  insulinActionMax: FLOAT    // Maximum durée action (h) — TODO Phase 1
  createdAt: DATETIME
}
```

**Bornes cliniques** :
- `ISF_GL_MIN: 0.20`, `ISF_GL_MAX: 1.00` (g/L/U)
- `ISF_MGDL_MIN: 20`, `ISF_MGDL_MAX: 100` (mg/dL/U)

---

### CarbRatio (ICR)

Ratio insuline-glucides par créneau horaire.

```typescript
{
  settingsId: INT (FK)
  startHour: INT             // 0-23
  endHour: INT               // 0-23
  startTime: TIME            // HH:MM:SS
  endTime: TIME              // HH:MM:SS
  gramsPerUnit: FLOAT        // g/U (ex: 8.0) — 1 U couvre 8g glucides
  mealLabel: STRING          // Petit-déjeuner, Déjeuner, etc.
  createdAt: DATETIME
}
```

**Bornes cliniques** :
- `ICR_MIN: 5.0`, `ICR_MAX: 20.0` (g/U)

---

### BasalConfiguration, PumpBasalSlot

Profil basal (pompe, injection simple, injection fractionnée).

```typescript
BasalConfiguration {
  id: INT (PK)
  settingsId: INT (FK, UNIQUE)
  configType: ENUM(BasalConfigType)  // pump, single_injection, split_injection
  insulinBrand: STRING

  // Selon configType — mutual exclusion
  totalDailyDose: FLOAT      // pump — calculée à partir des slots
  dailyDose: FLOAT           // single_injection
  morningDose: FLOAT         // split_injection
  eveningDose: FLOAT         // split_injection

  createdAt: DATETIME
}

PumpBasalSlot {
  id: INT (PK)
  basalConfigId: INT (FK)
  startTime: TIME            // HH:MM:SS (ex: 00:00:00)
  endTime: TIME              // HH:MM:SS (ex: 06:00:00)
  rate: FLOAT                // U/h (ex: 0.65) — débit basal
  durationHours: INT         // Durée du créneau
  createdAt: DATETIME
}
```

**Constraint** (DB trigger) : `chk_basal_config_type_fields` garantit mutual exclusion des champs selon configType.

**Bornes cliniques** :
- `BASAL_MIN: 0.05`, `BASAL_MAX: 10.0` (U/h)
- `PUMP_BASAL_INCREMENT: 0.05` (U/h) — résolution pompe

---

### IoB & ExtendedBolus Settings

```typescript
IobSettings {
  settingsId: INT (FK, UNIQUE)
  considerIob: BOOLEAN       // Prendre en compte IOB dans calcul
  actionDurationHours: FLOAT // Durée d'action insuline (h)
}

ExtendedBolusSettings {
  settingsId: INT (FK, UNIQUE)
  enabled: BOOLEAN           // Bolus étendu disponible
  immediatePercentage: FLOAT // % immédiat (ex: 100 = bolus standard)
}
```

---

## Domaine 4 : Glycémie & CGM (5 tables)

### CgmEntry

Entrées capteur continu (CGM) — **Partitionnée par trimestre**.

```typescript
{
  id: BIGINT (PK)            // Composite PK : (id, timestamp)
  patientId: INT (FK)
  valueGl: DECIMAL(6,4)      // g/L (ex: 1.2345) — CHECK >= 0.20 && <= 6.00
  timestamp: TIMESTAMPTZ     // Avec timezone
  isManual: BOOLEAN          // FALSE = capteur automatique
  deviceId: STRING           // Appareil source
  createdAt: TIMESTAMPTZ     // DEFAULT NOW()
}
```

**Partitioning** : Trimestres (Q1, Q2, Q3, Q4) 2024-2028 + DEFAULT partition.

**Index** :
- `(patient_id, timestamp)` — Requêtes par patient et plage temps
- `(timestamp)` — Requêtes globales time-series

**Capacité** : ~105k rows/patient/an (288 lectures/jour, intervalle 5 min).

---

### GlycemiaEntry

Mesures ponctuelles (glucomètre, capillaires).

```typescript
{
  patientId: INT (FK)
  glucoseValue: FLOAT        // mg/dL
  measurementType: STRING    // capillary, blood_test
  timestamp: TIMESTAMPTZ
  createdAt: TIMESTAMPTZ
}
```

---

### BolusCalculationLog

**Immuable** — Log du calcul de bolus avant acceptation patient.

```typescript
{
  id: INT (PK)
  patientId: INT (FK)
  inputGlucoseGl: FLOAT      // g/L saisie
  inputCarbsGrams: FLOAT     // g de glucides
  targetGlucoseMgdl: INT     // mg/dL visé
  isfUsedGl: FLOAT           // ISF appliqué (g/L/U)
  icrUsed: FLOAT             // ICR appliqué (g/U)
  mealBolus: FLOAT           // Bolus repas calculé (U)
  rawCorrectionDose: FLOAT   // Correction brute (U)
  iobValue: FLOAT            // Insuline déjà active (U)
  iobAdjustment: FLOAT       // Ajustement IOB (U)
  correctionDose: FLOAT      // Correction finale (U)
  recommendedDose: FLOAT     // Bolus total = meal + correction (U), arrondi 0.1U
  wasCapped: BOOLEAN         // TRUE si > MAX_SINGLE_BOLUS
  warnings: JSON             // Array d'avertissements
  deliveryMethod: STRING     // pump, manual
  createdAt: DATETIME
}
```

**Warnings possibles** :
- `severeHypoglycemia` — < 0.54 g/L
- `hypoglycemia` — 0.54-0.70 g/L
- `severeHyperglycemia` — > 2.50 g/L
- `criticalHighGlucose` — > 4.00 g/L
- `exceedsMaximumBolus` — > 25.0 U

**Immuabilité** : Aucun UPDATE/DELETE possible en production (audit trail).

---

### AverageData

Statistiques agrégées sur périodes.

```typescript
{
  patientId: INT (FK)
  period: DATE               // Date pour daily, semaine pour weekly
  averageGlucose: FLOAT      // g/L
  minGlucose: FLOAT
  maxGlucose: FLOAT
  stdDeviation: FLOAT        // Variabilité
  timeInRange: FLOAT         // % temps en cible
  createdAt: DATETIME
}
```

---

## Domaine 5 : Événements (3 tables)

### DiabetesEvent

Événements saisis par le patient.

```typescript
{
  id: INT (PK)
  patientId: INT (FK)
  eventType: ENUM(DiabetesEventType)[]  // ARRAY d'énums (Prisma 5+)
    // glycemia, insulinMeal, physicalActivity, context, occasional
  description: TEXT          // Notes libres
  timestamp: TIMESTAMPTZ
  createdAt: DATETIME
}
```

**Important** : `eventType` est un **ARRAY d'énums** — un événement peut être multi-catégorie (ex: insulinMeal + physicalActivity).

---

### InsulinFlowEntry, PumpEvent

Enregistrements d'administration insuline.

```typescript
InsulinFlowEntry {
  patientId: INT (FK)
  bolusAmount: FLOAT         // U
  timestamp: TIMESTAMPTZ
  deliveryMethod: STRING     // pump, manual
}

PumpEvent {
  patientId: INT (FK)
  eventType: STRING          // basal_rate_change, cartridge_low, occlusion
  timestamp: TIMESTAMPTZ
  data: JSON                 // Détails événement
}
```

---

## Domaine 6 : Ajustements (1 table)

### AdjustmentProposal

Suggestions d'ajustement **automatiques** (jamais exécutées sans approbation explicite).

```typescript
{
  id: INT (PK)
  patientId: INT (FK)
  parameter: ENUM(AdjustableParameter)  // basalRate, insulinSensitivityFactor, insulinToCarbRatio
  reason: ENUM(AdjustmentReason)        // basalTooLow, isfTooHigh, icrCorrect, ...
  proposedValue: FLOAT       // Nouvelle valeur suggérée
  confidence: ENUM(ConfidenceLevel)     // low, medium, high
  status: ENUM(ProposalStatus)          // pending, accepted, rejected, expired
  reviewedBy: INT            // FK → User (DOCTOR uniquement) — NULL si pending
  reviewedAt: DATETIME       // NULL si pending
  appliedAt: DATETIME        // NULL si rejected
  expiresAt: DATETIME        // Après cette date → expired
  metadata: JSON             // Détails algo (ex: { dataPoints: 50, tir: 0.65 })
  createdAt: DATETIME
}
```

**Workflow** :
1. Algo génère AdjustmentProposal avec `status = pending`
2. DOCTOR reçoit notification
3. DOCTOR accepte ou rejette → `status = accepted/rejected`, `reviewedBy` set
4. Automatique après expiresAt → `status = expired`

---

## Domaine 7 : Appareils (4 tables)

### PatientDevice, DeviceDataSync, InsulinFlowDeviceData

Gestion des appareils (CGM, pompe, glucomètre).

```typescript
PatientDevice {
  id: INT (PK)
  patientId: INT (FK)
  category: ENUM(DeviceCategory)  // glucometer, cgm, insulinPump, insulinPen, healthApp
  brand: STRING                   // Dexcom, FreeStyle, Medtronic
  model: STRING
  serialNumber: STRING
  isActive: BOOLEAN
  pairedAt: DATETIME
  unpairedAt: DATETIME
}

DeviceDataSync {
  patientId: INT (FK)
  deviceId: INT (FK)
  lastSyncTime: DATETIME
  lastSyncStatus: STRING      // success, failed
  syncError: TEXT             // Message d'erreur si failed
  sequenceNumber: INT         // Pour détection conflits
  createdAt: DATETIME
}

InsulinFlowDeviceData {
  patientId: INT (FK)
  deviceId: INT (FK)
  bolusAmount: FLOAT
  bolusType: STRING           // standard, extended
  timestamp: TIMESTAMPTZ
}
```

---

## Domaine 8 : Équipe médicale (4 tables)

### HealthcareService, HealthcareMember, PatientService, PatientReferent

Structure de santé et équipe soignante.

```typescript
HealthcareService {
  id: INT (PK)
  name: STRING               // Service Diabétologie
  establishment: STRING      // CHU Paris, Cabinet privé
  city: STRING
  country: CHAR(2)
  createdAt: DATETIME
  @@unique([name, establishment])
}

HealthcareMember {
  id: INT (PK)
  serviceId: INT (FK)
  userId: INT (FK)           // Professionnel
  name: STRING               // Affichage public
  profession: STRING         // Diabétologue, IDE, pharmacien
  createdAt: DATETIME
  @@unique([name, serviceId])
}

PatientService {
  patientId: INT (FK)
  serviceId: INT (FK)
  memberId: INT (FK)         // Member responsable
  joinedAt: DATETIME
  @@unique([patientId, serviceId])
}

PatientReferent {
  patientId: INT (FK, UNIQUE)  // 1 référent par patient
  proId: INT (FK)              // HealthcareMember (DOCTOR)
  serviceId: INT (FK)
}
```

**Relation** : Patient → Équipe médicale → Professionnels

---

## Domaine 9 : Documents (3 tables)

### MedicalDocument, Appointment, Announcement

Documents médicaux, rendez-vous, annonces.

```typescript
MedicalDocument {
  id: INT (PK)
  patientId: INT (FK)
  category: ENUM(DocumentCategory)  // general, prescription, labResults, other
  title: STRING
  fileName: STRING           // Nom fichier
  s3Url: STRING              // OVH Object Storage URL
  fileSize: INT              // Bytes
  uploadedBy: INT (FK)       // User ID
  uploadedAt: DATETIME
}

Appointment {
  id: INT (PK)
  patientId: INT (FK)
  proId: INT (FK)            // HealthcareMember
  scheduledAt: DATETIME      // Date/heure RDV
  type: STRING               // consultation, phone, video
  notes: TEXT
  isConfirmed: BOOLEAN
  createdAt: DATETIME
}

Announcement {
  id: INT (PK)
  title: STRING
  content: TEXT
  targetRole: ENUM(Role)     // DOCTOR, NURSE, VIEWER
  publishedAt: DATETIME
}
```

---

## Domaine 10 : Notifications Push (4 tables)

### PushDeviceRegistration, PushNotificationTemplate, PushNotificationLog, PushScheduledNotification

Système de notifications.

```typescript
PushDeviceRegistration {
  userId: INT (FK)
  platform: ENUM(PushPlatform)  // ios, android, web
  fcmToken: STRING
  isActive: BOOLEAN
  registeredAt: DATETIME
  @@unique([userId, fcmToken])
}

PushNotificationTemplate {
  id: INT (PK)
  name: STRING               // glucose_alert, appointment_reminder
  title: STRING              // Titre avec variables {{patient}}
  body: TEXT                 // Corps avec variables
  variables: JSON            // Champs à templater
  iosConfig: JSON            // { interruptionLevel, sound }
  androidConfig: JSON        // { priority, channel }
}

PushNotificationLog {
  userId: INT (FK)
  templateId: INT (FK)
  status: ENUM(PushNotifStatus)  // pending, sent, delivered, failed
  sentAt: DATETIME
  deliveredAt: DATETIME
  failureReason: TEXT
}

PushScheduledNotification {
  id: INT (PK)
  userId: INT (FK)
  templateId: INT (FK)
  schedule: ENUM(ScheduleType)   // once, daily, weekly, custom_cron
  scheduleCron: STRING           // '0 9 * * *' si custom_cron
  nextScheduledTime: DATETIME
  isActive: BOOLEAN
}
```

---

## Domaine 11 : Configuration UI (3 tables)

### DashboardConfiguration, DashboardWidget, UserDayMoment, UnitDefinition, UiStateSave

Customisation de l'interface.

```typescript
DashboardConfiguration {
  userId: INT (FK, UNIQUE)
  layout: JSON               // Positionnement widgets
  refreshRate: INT           // Secondes
  createdAt: DATETIME
}

DashboardWidget {
  id: INT (PK)
  configId: INT (FK)
  name: STRING               // glucose_chart, hba1c_trend
  position: INT              // Ordre
  isVisible: BOOLEAN
}

UserDayMoment {
  userId: INT (FK)
  type: ENUM(DayMomentType)  // morning, noon, evening, night, custom
  startTime: TIME
  endTime: TIME
  @@unique([userId, type])
}

UnitDefinition {
  unitCode: INT (PK, UNIQUE)
  category: STRING           // carb, glycemia, weight, size, hba1c
  unit: STRING               // g/L, mg/dL, kg, cm, %
  title: STRING              // Grammes par litre, etc.
  factor: FLOAT              // Conversion vers SI (ex: g/L = factor 1.0)
  precision: INT             // Chiffres décimales d'affichage
}

UiStateSave {
  userId: INT (FK)
  stateKey: STRING           // Clé UI state (ex: "patientsListSort")
  stateValue: JSON           // Valeur sauvegardée
  @@unique([userId, stateKey])
}
```

---

## Domaine Spécial : Audit (1 table)

### AuditLog

Table **immuable** — Traçabilité HDS conforme.

```typescript
{
  id: BIGINT (PK)
  userId: INT (FK)           // Qui a fait l'action
  action: STRING             // LOGIN, READ, CREATE, UPDATE, DELETE, BOLUS_CALCULATED
  resource: STRING           // PATIENT, CGM_ENTRY, BOLUS_LOG, USER
  resourceId: STRING         // ID de la ressource
  oldValue: JSON             // Avant modification (NULL si CREATE/READ)
  newValue: JSON             // Après modification (NULL si READ/DELETE)
  ipAddress: STRING          // IP de la requête
  userAgent: STRING          // User-Agent header
  metadata: JSON             // Contexte additionnel
  createdAt: DATETIME        // DEFAULT NOW()
}
```

**Index** :
- `(userId, createdAt)` — Historique par utilisateur
- `(resource, resourceId, createdAt)` — Historique par ressource

**Immuabilité** (DB trigger) : Aucun UPDATE/DELETE possible. PostgreSQL lève une exception.

**Contenu** : **JAMAIS de données de santé en clair**. Seulement les métadonnées.

---

## Stratégie de partitioning

### CGM Entries (CgmEntry)

Table volumineuse → **Partitioning par trimestre**.

**Volume estimé** :
- 288 lectures/jour (5 min intervalle)
- ~105k rows/patient/an
- 50k patients → 5.25B rows

**Stratégie** : RANGE partitioning sur `timestamp`

```sql
PARTITION BY RANGE (timestamp)
CREATE TABLE cgm_entries_2025_q1 FOR VALUES FROM ('2025-01-01') TO ('2025-04-01')
CREATE TABLE cgm_entries_2025_q2 FOR VALUES FROM ('2025-04-01') TO ('2025-07-01')
... (Voir prisma/sql/cgm_partitioning.sql)
```

**Bénéfices** :
- Maintenance rapide (drop partition = purge 3 mois)
- Index plus petits
- Queries time-bound plus rapides

---

## Stratégie d'indexation

| Table | Index | Purpose |
|-------|-------|---------|
| `users` | emailHmac (UNIQUE) | Lookup email sans crypto |
| `users` | createdAt | Timeline |
| `cgm_entries` | (patient_id, timestamp) | Requêtes patients + range |
| `cgm_entries` | timestamp | Requêtes globales time-series |
| `audit_logs` | (userId, createdAt) | Historique utilisateur |
| `audit_logs` | (resource, resourceId, createdAt) | Historique ressource |
| `insulin_therapy_settings` | patientId (UNIQUE) | 1:1 patient |
| `patient` | deletedAt | WHERE deletedAt IS NULL filtering |

---

## Champs chiffrés (résumé)

Tous les champs sensibles sont chiffrés en production via `encryptField()` / `decryptField()` (AES-256-GCM base64) :

### Utilisateurs (User table)
- email, firstname, firstnames, usedFirstname, lastname, usedLastname
- birthday, codeBirthPlace
- phone, address1, address2, cp, city
- nirpp, nirppPolicyholder, ins

### Patients (PatientMedicalData, etc.)
- Données médicales chiffrées si données sensibles

---

## Migration & Seed

### Seed data (prisma/seed.ts)

```bash
pnpm prisma db seed
```

Crée :
- 5 users (admin, doctor, nurse, patient DT1, patient DT2)
- 2 patients (DT1 pompe, DT2 injections)
- 30 jours de données CGM déterministes (seed = 42)
- ISF/ICR/basal slots 24h
- Healthcare service + team

### SQL Scripts (manuels)

```bash
# Après initial migration
psql $DATABASE_URL < prisma/sql/audit_immutability.sql
psql $DATABASE_URL < prisma/sql/cgm_partitioning.sql
psql $DATABASE_URL < prisma/sql/basal_config_check.sql
```

---

Dernière mise à jour : 2026-03-31 (Phase 0)
