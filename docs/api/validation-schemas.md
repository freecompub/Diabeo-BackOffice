# Schemas de validation (Zod)

Tous les inputs API sont valides avec Zod avant traitement. Ce document liste les schemas critiques et leurs bornes.

## Donnees medicales

### Bolus (calculate-bolus)

| Champ | Type | Min | Max | Description |
|-------|------|-----|-----|-------------|
| currentGlucoseGl | number | 0.20 | 6.00 | Glycemie actuelle en g/L |
| carbsGrams | number | 0 | 500 | Glucides du repas en grammes |
| patientId | number? | 1 | — | ID patient (pros uniquement) |

### Evenement diabete (events)

| Champ | Type | Validation | Description |
|-------|------|-----------|-------------|
| eventDate | datetime | ISO 8601 | Date de l'evenement |
| eventTypes | enum[] | min 1 | glycemia, insulinMeal, physicalActivity, context, occasional |
| glycemiaValue | number? | 20-600 | mg/dL — requis si eventTypes contient "glycemia" |
| carbohydrates | number? | >= 0 | Grammes — requis si "insulinMeal" |
| bolusDose | number? | 0-25 | U — plafond securite |
| basalDose | number? | 0-10 | U/h |
| activityType | enum? | — | walking, running, cycling... requis si "physicalActivity" |
| activityDuration | int? | > 0, <= 600 | Minutes — requis si "physicalActivity" |
| contextType | enum? | — | stress, illness, menstruation... requis si "context" |
| hba1c | number? | 4.0-14.0 | % — borne clinique validee |
| comment | string? | min 1, max 1000 | Chiffre AES-256-GCM en base |

### Validations croisees (superRefine)

- `glycemia` dans eventTypes → `glycemiaValue` obligatoire
- `insulinMeal` dans eventTypes → `carbohydrates` obligatoire
- `physicalActivity` dans eventTypes → `activityType` + `activityDuration` obligatoires
- `context` dans eventTypes → `contextType` obligatoire

## Insulinotherapie

### ISF (sensitivity-factors)

| Champ | Type | Min | Max | Unite |
|-------|------|-----|-----|-------|
| startHour | int | 0 | 23 | Heure |
| endHour | int | 0 | 23 | Heure |
| sensitivityFactorGl | number | 0.10 | 1.00 | g/L/U |

### ICR (carb-ratios)

| Champ | Type | Min | Max | Unite |
|-------|------|-----|-----|-------|
| startHour | int | 0 | 23 | Heure |
| endHour | int | 0 | 23 | Heure |
| gramsPerUnit | number | 3.0 | 30.0 | g/U |

### CGM Objectives

| Champ | Type | Min | Max | Contrainte |
|-------|------|-----|-----|-----------|
| veryLow | number | 0.30 | 1.00 | < low |
| low | number | 0.40 | 1.50 | < ok |
| ok | number | 1.00 | 3.00 | < high |
| high | number | 1.50 | 5.00 | — |
| titrLow | number | 0.40 | 1.50 | < titrHigh |
| titrHigh | number | 1.00 | 3.00 | — |

### Annex Objectives

| Champ | Type | Min | Max |
|-------|------|-----|-----|
| objectiveHba1c | number? | 4.0 | 14.0 |
| objectiveMinWeight | number? | 20 | 300 |
| objectiveMaxWeight | number? | 20 | 300 |
| objectiveWalk | int? | 0 | 600 |

Contrainte : `objectiveMinWeight <= objectiveMaxWeight`

## Sync

| Champ | Type | Validation | Description |
|-------|------|-----------|-------------|
| deviceUid | string | min 1, max 100 | Identifiant appareil |
| sequenceNum | string | regex `/^\d+$/` | Entier positif (string pour BigInt safety) |

## Push notifications

### Scheduled

| Champ | Type | Validation |
|-------|------|-----------|
| templateId | string | min 1, max 50 |
| scheduleType | enum | once, daily, weekly, custom_cron |
| cronExpression | string? | regex 5 champs, requis si recurring |
| templateVariables | Record<string, string>? | Valeurs max 500 chars |
| maxOccurrences | int? | > 0 |

## Conversion d'unites

Toutes les donnees glycemiques sont stockees en **g/L**. Conversion a l'affichage :

| De | Vers | Formule |
|----|------|---------|
| g/L | mg/dL | x 100 |
| g/L | mmol/L | x 5.5506 |
| mg/dL | g/L | / 100 |
| mmol/L | g/L | / 5.5506 |
