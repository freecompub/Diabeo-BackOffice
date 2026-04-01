# Logique métier médicale — Diabeo Backoffice

Documentation des concepts et calculs médicaux implémentés.

---

## 1. Vue d'ensemble de l'insulinothérapie

### Concepts clés

L'insulinothérapie intensive repose sur le calcul de trois composantes :

| Composante | Rôle | Calcul |
|-----------|------|--------|
| **Bolus repas** | Couvrir glucides ingérés | Carbs (g) ÷ ICR (g/U) |
| **Bolus correction** | Ramener glycémie vers cible | max(0, (Glyc. - Cible) ÷ ISF) |
| **IOB ajustement** | Soustaire insuline active | Bolus précédents - dégradation |

**Bolus final** = Bolus repas + Correction - IOB, arrondi à 0.1U, capé à MAX_SINGLE_BOLUS (25U)

---

## 2. Ratios insuline — Structure horaire

### Insulin Sensitivity Factor (ISF)

**Définition** : Baisse de glycémie (en g/L ou mg/dL) pour 1 unité d'insuline injectée.

**Exemple** :
- ISF = 0.30 g/L/U → 1 unité baisse glycémie de 0.30 g/L
- Si glycémie = 1.8 g/L et cible = 1.2 g/L → Correction = (1.8 - 1.2) ÷ 0.30 = 2.0U

**Unités de conversion** :
- mg/dL × 0.0555 ≈ g/L
- g/L × 18 ≈ mg/dL

**Bornes cliniques** :
```typescript
ISF_GL_MIN: 0.20      // Très sensible
ISF_GL_MAX: 1.00      // Peu sensible
ISF_MGDL_MIN: 20      // mg/dL equivalent
ISF_MGDL_MAX: 100     // mg/dL equivalent
```

### Insulin-to-Carb Ratio (ICR)

**Définition** : Grammes de glucides couverts par 1 unité d'insuline.

**Exemple** :
- ICR = 8.0 g/U → 1 unité couvre 8g de glucides
- Repas = 45g glucides → Bolus repas = 45 ÷ 8 = 5.625U ≈ 5.6U

**Bornes cliniques** :
```typescript
ICR_MIN: 5.0          // 1U couvre 5g (très peu)
ICR_MAX: 20.0         // 1U couvre 20g (beaucoup)
```

### Structure horaire (Time Slots)

**Pattern** : Ratios variables sur 24h selon moments de la journée.

**Exemple seed** (Patient DT1) :
```typescript
// ISF — 3 créneaux
[
  { startHour: 6,  endHour: 12, sensitivityFactorGl: 0.30 },  // Matin
  { startHour: 12, endHour: 22, sensitivityFactorGl: 0.50 },  // Jour/soir
  { startHour: 22, endHour: 6,  sensitivityFactorGl: 0.60 }   // Nuit
]

// ICR — 2 créneaux
[
  { startHour: 6,  endHour: 12, gramsPerUnit: 8.0 },    // Petit-déj
  { startHour: 12, endHour: 6,  gramsPerUnit: 12.0 }    // Déj/dîner/nuit
]
```

**Sélection du créneau** : Pour l'heure actuelle, trouver le créneau applicable.

```typescript
function findSlotForHour<T extends { startHour: number; endHour: number }>(
  slots: T[],
  hour: number,
): T | undefined {
  return slots.find((s) => {
    if (s.startHour <= s.endHour) {
      // Créneau normal (ex: 6h-12h)
      return hour >= s.startHour && hour < s.endHour
    }
    // Créneau traversant minuit (ex: 22h-6h)
    return hour >= s.startHour || hour < s.endHour
  })
}
```

**Exemple** :
- Heure actuelle = 14h → Créneau 12h-22h → ISF = 0.50 g/L/U
- Heure actuelle = 3h → Créneau 22h-6h → ISF = 0.60 g/L/U (nuit)

---

## 3. Cibles glycémiques (Glucose Targets)

### Presets standard

```typescript
enum GlucoseTargetPreset {
  standard     // Adulte type → 80-180 mg/dL (0.70-1.80 g/L)
  tight        // Glycémie serrée → 70-140 mg/dL (0.70-1.40 g/L)
  pediatric    // Enfant → 90-180 mg/dL (0.90-1.80 g/L)
  elderly      // Personne âgée → 100-180 mg/dL (1.00-1.80 g/L)
  custom       // Personnalisé
}
```

### Données stockées

```typescript
{
  targetGlucose: 120,           // mg/dL valeur cible
  targetRangeLower: 0.70,       // g/L minimum acceptable
  targetRangeUpper: 1.80,       // g/L maximum acceptable
  preset: GlucoseTargetPreset,
  isActive: boolean             // Laquelle est actuellement utilisée
}
```

**Usage dans calcul bolus** :
- Correction = max(0, (glycémie actuelle - targetGlucose) ÷ ISF)

---

## 4. Profils basals (Basal Configurations)

### Types de configuration

```typescript
enum BasalConfigType {
  pump             // Bolus-basal via pompe insuline
  single_injection // 1 injection basale/jour (ex: Lantus matin)
  split_injection  // 2 injections basales/jour (ex: Lantus matin + soir)
}
```

### Pump configuration (PumpBasalSlot)

**Pour les patients sous pompe** : Débit basal varie par heure.

**Exemple** (Patient DT1 seed) :
```typescript
[
  { startTime: "00:00:00", endTime: "06:00:00", rate: 0.65 U/h },  // Nuit faible
  { startTime: "06:00:00", endTime: "12:00:00", rate: 0.85 U/h },  // Matin normal
  { startTime: "12:00:00", endTime: "22:00:00", rate: 0.75 U/h },  // Jour modéré
  { startTime: "22:00:00", endTime: "00:00:00", rate: 0.70 U/h }   // Soir baisse
]
```

**Total basal quotidien** : 0.65×6 + 0.85×6 + 0.75×10 + 0.70×2 = 18.6 U/jour

### Single/Split injection

```typescript
// Single injection
{
  configType: "single_injection",
  dailyDose: 22.0 U    // Lantus une fois par jour
}

// Split injection
{
  configType: "split_injection",
  morningDose: 12.0 U,     // Lantus matin
  eveningDose: 10.0 U      // Lantus soir
}
```

**Constraint DB** : `chk_basal_config_type_fields` garantit qu'un seul type de champ est renseigné.

---

## 5. Calcul de bolus implémenté

### Algorithme complet

**Fichier** : `src/lib/services/insulin.service.ts` → `calculateBolus()`

```typescript
async calculateBolus(input: BolusInput, auditUserId: number): Promise<BolusResult> {
  // 1. Récupérer la configuration insuline du patient
  const settings = await this.getSettings(input.patientId)
  if (!settings) throw new Error("No insulin therapy settings")

  const hour = new Date().getHours()

  // 2. Sélectionner ISF et ICR pour l'heure actuelle
  const isf = findSlotForHour(settings.sensitivityFactors, hour)
  const icr = findSlotForHour(settings.carbRatios, hour)
  const target = settings.glucoseTargets[0]

  // 3. Calculs numériques
  const isfGl = Number(isf.sensitivityFactorGl)           // g/L/U
  const isfMgdl = Number(isf.sensitivityFactorMgdl)       // mg/dL/U
  const icrValue = Number(icr.gramsPerUnit)              // g/U
  const targetMgdl = Number(target.targetGlucose)        // mg/dL
  const currentMgdl = input.currentGlucoseGl * 100      // Conversion g/L → mg/dL

  // 4. Bolus repas
  const mealBolus = input.carbsGrams / icrValue

  // 5. Correction brute
  const rawCorrectionDose = (currentMgdl - targetMgdl) / isfMgdl

  // 6. IOB ajustement (placeholder — Phase 2)
  let iobAdjustment = 0
  if (settings.iobSettings?.considerIob) {
    // TODO: Calculer IOB depuis historique bolus précédents
    iobAdjustment = 0
  }

  // 7. Correction finale (jamais négative)
  const correctionDose = Math.max(0, rawCorrectionDose - iobAdjustment)

  // 8. Total brut
  const rawTotal = mealBolus + correctionDose

  // 9. Arrondir à 0.1U et capper à MAX (25U)
  const recommendedDose = roundToTenths(
    Math.min(rawTotal, CLINICAL_BOUNDS.MAX_SINGLE_BOLUS)
  )
  const wasCapped = rawTotal > CLINICAL_BOUNDS.MAX_SINGLE_BOLUS

  // 10. Déterminer avertissements
  const warnings: string[] = []
  if (input.currentGlucoseGl < 0.54) warnings.push("severeHypoglycemia")
  else if (input.currentGlucoseGl < 0.70) warnings.push("hypoglycemia")
  if (input.currentGlucoseGl > 2.50) warnings.push("severeHyperglycemia")
  if (input.currentGlucoseGl > 4.00) warnings.push("criticalHighGlucose")
  if (wasCapped) warnings.push("exceedsMaximumBolus")

  // 11. Transaction : log + audit
  await prisma.$transaction(async (tx) => {
    await tx.bolusCalculationLog.create({
      data: {
        patientId: input.patientId,
        inputGlucoseGl: input.currentGlucoseGl,
        inputCarbsGrams: input.carbsGrams,
        targetGlucoseMgdl: targetMgdl,
        isfUsedGl: isfGl,
        icrUsed: icrValue,
        mealBolus: roundToHundredths(mealBolus),
        rawCorrectionDose: roundToHundredths(rawCorrectionDose),
        iobValue: 0,
        iobAdjustment: roundToHundredths(iobAdjustment),
        correctionDose: roundToHundredths(correctionDose),
        recommendedDose,
        wasCapped,
        warnings,
        deliveryMethod: settings.deliveryMethod,
      },
    })

    await auditService.logWithTx(tx, {
      userId: auditUserId,
      action: "BOLUS_CALCULATED",
      resource: "BOLUS_LOG",
      resourceId: String(input.patientId),
      metadata: {
        inputGlucoseGl: input.currentGlucoseGl,
        recommendedDose,
        warnings,
      },
    })
  })

  return {
    mealBolus: roundToHundredths(mealBolus),
    rawCorrectionDose: roundToHundredths(rawCorrectionDose),
    iobAdjustment: roundToHundredths(iobAdjustment),
    correctionDose: roundToHundredths(correctionDose),
    recommendedDose,
    wasCapped,
    warnings,
    deliveryMethod: settings.deliveryMethod,
  }
}
```

### Exemple numérique

**Données d'entrée** :
- Glycémie actuelle : 1.4 g/L (140 mg/dL)
- Glucides repas : 45g
- Heure actuelle : 14h (créneau 12h-22h)
- Configuration : ISF = 0.50 g/L/U, ICR = 12.0 g/U, Cible = 120 mg/dL

**Calculs** :
```
1. Bolus repas = 45g ÷ 12.0 g/U = 3.75U
2. Correction brute = (140 - 120) mg/dL ÷ 50 mg/dL/U = 0.4U
3. IOB ajustement = 0U (placeholder)
4. Correction finale = max(0, 0.4 - 0) = 0.4U
5. Total brut = 3.75 + 0.4 = 4.15U
6. Total arrondi = 4.2U
7. Warnings = [] (glycémie normale)
```

**Résultat** :
```json
{
  "mealBolus": 3.75,
  "rawCorrectionDose": 0.4,
  "correctionDose": 0.4,
  "recommendedDose": 4.2,
  "wasCapped": false,
  "warnings": [],
  "deliveryMethod": "pump"
}
```

---

## 6. Bornes cliniques et sécurité

### CLINICAL_BOUNDS

```typescript
const CLINICAL_BOUNDS = {
  // ISF (Insulin Sensitivity Factor)
  ISF_GL_MIN: 0.20,      // g/L/U — très sensible
  ISF_GL_MAX: 1.00,      // g/L/U — peu sensible
  ISF_MGDL_MIN: 20,      // mg/dL/U
  ISF_MGDL_MAX: 100,     // mg/dL/U

  // ICR (Insulin-to-Carb Ratio)
  ICR_MIN: 5.0,          // g/U — couvre beaucoup
  ICR_MAX: 20.0,         // g/U — couvre peu

  // Basal rate
  BASAL_MIN: 0.05,       // U/h
  BASAL_MAX: 10.0,       // U/h
  PUMP_BASAL_INCREMENT: 0.05,  // Résolution pompe

  // Glycémie
  TARGET_MIN_MGDL: 60,   // mg/dL minimum
  TARGET_MAX_MGDL: 250,  // mg/dL maximum

  // Bolus
  MAX_SINGLE_BOLUS: 25.0,  // U — jamais dépasser
  INSULIN_ACTION_MIN: 3.5, // h
  INSULIN_ACTION_MAX: 5.0, // h
} as const
```

### Validation des paramètres

**À implémenter Phase 2+** : Vérifier que chaque configuration patient respecte les bornes.

```typescript
function validateInsulinSettings(settings: InsulinTherapySettings): ValidationError[] {
  const errors: ValidationError[] = []

  for (const isf of settings.sensitivityFactors) {
    if (isf.sensitivityFactorGl < CLINICAL_BOUNDS.ISF_GL_MIN ||
        isf.sensitivityFactorGl > CLINICAL_BOUNDS.ISF_GL_MAX) {
      errors.push({
        field: "sensitivityFactorGl",
        message: `ISF must be between ${CLINICAL_BOUNDS.ISF_GL_MIN} and ${CLINICAL_BOUNDS.ISF_GL_MAX} g/L/U`
      })
    }
  }

  for (const icr of settings.carbRatios) {
    if (icr.gramsPerUnit < CLINICAL_BOUNDS.ICR_MIN ||
        icr.gramsPerUnit > CLINICAL_BOUNDS.ICR_MAX) {
      errors.push({
        field: "carbRatio",
        message: `ICR must be between ${CLINICAL_BOUNDS.ICR_MIN} and ${CLINICAL_BOUNDS.ICR_MAX} g/U`
      })
    }
  }

  return errors
}
```

### Warnings lors du calcul

Lors du `calculateBolus()`, plusieurs avertissements peuvent être générés :

| Warning | Condition | Sévérité |
|---------|-----------|----------|
| `severeHypoglycemia` | Glyc < 0.54 g/L (< 50 mg/dL) | CRITIQUE |
| `hypoglycemia` | 0.54 ≤ Glyc < 0.70 g/L | HAUTE |
| `severeHyperglycemia` | Glyc > 2.50 g/L (> 250 mg/dL) | HAUTE |
| `criticalHighGlucose` | Glyc > 4.00 g/L (> 400 mg/dL) | CRITIQUE |
| `exceedsMaximumBolus` | Bolus brut > 25.0 U | HAUTE |

**Action** : Afficher les warnings à l'utilisateur — jamais auto-injecter si warning critique.

---

## 7. Insulin On Board (IOB)

### Concept

**IOB (Insulin On Board)** : Quantité d'insuline restante active dans l'organisme.

**Durée d'action** : 3.5 à 5 heures selon l'insuline.

### Modèles IOB (Phase 2+)

**Modèle linéaire** (simple) :
```
IOB(t) = Bolus × max(0, 1 - t/actionDuration)
```

**Modèle Walshian** (réaliste) :
```
IOB(t) = Bolus × (1 - t²/actionDuration²)  if t < actionDuration
```

### Implémentation Phase 2

```typescript
function calculateIOB(
  previousBoluses: { amount: number; timestamp: Date }[],
  actionDurationHours: number,
  now: Date = new Date()
): number {
  let totalIOB = 0

  for (const bolus of previousBoluses) {
    const minutesSince = (now.getTime() - bolus.timestamp.getTime()) / (1000 * 60)
    const hoursSince = minutesSince / 60

    if (hoursSince < actionDurationHours) {
      // IOB encore active
      const fractionRemaining = 1 - (hoursSince / actionDurationHours)
      totalIOB += bolus.amount * fractionRemaining
    }
  }

  return totalIOB
}

// Usage dans calculateBolus()
if (settings.iobSettings?.considerIob) {
  const recentBoluses = await tx.bolusCalculationLog.findMany({
    where: {
      patientId: input.patientId,
      createdAt: {
        gte: new Date(Date.now() - 5 * 60 * 60 * 1000) // 5 heures
      }
    }
  })

  iobAdjustment = calculateIOB(
    recentBoluses.map(b => ({ amount: b.recommendedDose, timestamp: b.createdAt })),
    settings.iobSettings.actionDurationHours
  )
}
```

---

## 8. Propositions d'ajustement (Adjustment Proposals)

### Workflow complet

```
1. Algorithme d'analyse (Phase 3)
   ├─ Collecte 14j de données (CGM, bolus, events)
   ├─ Analyse TIR, moyenne, variabilité
   └─ Génère suggestions : ISF trop bas? ICR trop haut?

2. Créer AdjustmentProposal
   {
     patientId: 1,
     parameter: "insulinSensitivityFactor",
     reason: "isfTooLow",
     proposedValue: 0.35,
     confidence: "medium",
     status: "pending",
     expiresAt: NOW() + 7 jours
   }

3. Notification médecin
   → Email/push : "Nouvelle proposition pour patient Jean D."

4. Review médecin (DOCTOR rôle)
   → Accepte ou rejette
   → Met à jour status + reviewedBy + reviewedAt

5. Appliqué si accepté
   → Crée nouvelle InsulinSensitivityFactor
   → Recalcule configurations affectées

6. Expire si non reviewed
   → Après expiresAt, status → "expired"
```

### Paramètres ajustables

```typescript
enum AdjustableParameter {
  basalRate,                    // Débit basal
  insulinSensitivityFactor,    // ISF
  insulinToCarbRatio           // ICR
}

enum AdjustmentReason {
  basalTooLow,                 // Hyperglycémie persistante la nuit
  basalTooHigh,                // Hypoglycémie persistante la nuit
  basalCorrect,                // Basal bon
  isfTooLow,                   // Correction insuffisante
  isfTooHigh,                  // Hypoglycémie post-correction
  isfCorrect,
  icrTooLow,                   // Hyperglycémie post-repas
  icrTooHigh,                  // Hypoglycémie post-repas
  icrCorrect,
  insufficientData             // Pas assez de données pour proposer
}
```

---

## 9. Constantes médicales

### Glycémie

```typescript
// Seuils en g/L
const GLYCEMIA_THRESHOLDS = {
  severeHypoglycemia: 0.54,     // < 50 mg/dL
  hypoglycemia: 0.70,            // < 70 mg/dL
  normal: { min: 0.70, max: 1.80 },  // 70-180 mg/dL
  hyperglycemia: 2.50,           // > 250 mg/dL
  criticalHigh: 4.00,            // > 400 mg/dL
}

// Conversion
const MG_DL_TO_G_L = 0.0555
const G_L_TO_MG_DL = 18
```

### HbA1c

```typescript
// Objectifs HbA1c en % (NGSP)
const HBA1C_TARGETS = {
  general: 7.0,           // Adulte standard
  stricter: 6.5,          // Jeune sans comorbidités
  relaxed: 7.5,           // Personnes âgées
  veryRelaxed: 8.0,       // Comorbidités avancées
}

// Conversion NGSP ↔ IFCC
const ifcc = (ngsp: number) => 10.93 * ngsp - 23.5  // mmol/mol
const ngsp = (ifcc: number) => (ifcc + 23.5) / 10.93
```

### Variabilité glycémique

```typescript
// Coefficient de variation (CV) en %
const GLYCEMIA_VARIABILITY = {
  excellent: 15,    // CV < 15%
  good: 25,         // CV 15-25%
  fair: 35,         // CV 25-35%
  poor: 50,         // CV 35-50%
}
```

### Time In Range (TIR)

```typescript
// Distribution du temps en 24h
const TIR_TARGETS = {
  timeInRange: 0.70,          // > 70% temps 70-180 mg/dL
  timeBelowRange: 0.04,       // < 4% temps < 70 mg/dL
  timeWellAboveRange: 0.05,   // < 5% temps > 250 mg/dL
}
```

---

## 10. Unités de mesure et conversions

### Glycémie

```typescript
const UNITS = {
  // Code → Définition (voir UnitDefinition table)
  3: { unit: "g/L", factor: 1.0 },
  4: { unit: "mg/dL", factor: 18.0 },    // mg/dL = g/L × 18
  5: { unit: "mmol/L", factor: 5.55 },   // mmol/L = g/L × 5.55
}

// Conversion
const toGl = (value: number, unit: "g/L" | "mg/dL" | "mmol/L"): number => {
  switch (unit) {
    case "g/L": return value
    case "mg/dL": return value / 18
    case "mmol/L": return value / 5.55
  }
}

const fromGl = (value: number, unit: "g/L" | "mg/dL" | "mmol/L"): number => {
  switch (unit) {
    case "g/L": return value
    case "mg/dL": return value * 18
    case "mmol/L": return value * 5.55
  }
}
```

### Autres unités

| Catégorie | Codes | Facteurs |
|-----------|-------|----------|
| Glucides | 1 (CP), 2 (g) | 1 portion ≈ 15g |
| Poids | 6 (kg), 7 (lbs) | 1 lbs = 0.453 kg |
| Taille | 8 (cm), 9 (ft) | 1 ft = 30.48 cm |
| HbA1c | 10 (%), 11 (mmol/mol) | (% × 10.93) - 23.5 = mmol/mol |
| Cétones | 12 (mmol/L), 13 (mg/dL) | 1 mmol/L = 18 mg/dL |
| Tension | 14 (mmHg) | Aucune conversion |

---

## 11. Validation et contraintes

### À implémenter Phase 2+

**Avant sauvegarde InsulinTherapySettings** :

```typescript
function validateInsulinTherapySettings(settings: InsulinTherapySettings): void {
  // Vérifier ISF dans les bornes
  for (const isf of settings.sensitivityFactors) {
    if (isf.sensitivityFactorGl < ISF_GL_MIN || isf.sensitivityFactorGl > ISF_GL_MAX) {
      throw new Error(`Invalid ISF: ${isf.sensitivityFactorGl}`)
    }
  }

  // Vérifier ICR dans les bornes
  for (const icr of settings.carbRatios) {
    if (icr.gramsPerUnit < ICR_MIN || icr.gramsPerUnit > ICR_MAX) {
      throw new Error(`Invalid ICR: ${icr.gramsPerUnit}`)
    }
  }

  // Vérifier basal dans les bornes
  if (settings.basalConfiguration?.pumpSlots) {
    for (const slot of settings.basalConfiguration.pumpSlots) {
      if (slot.rate < BASAL_MIN || slot.rate > BASAL_MAX) {
        throw new Error(`Invalid basal rate: ${slot.rate}`)
      }
      if (slot.rate % PUMP_BASAL_INCREMENT !== 0) {
        throw new Error(`Basal rate not a multiple of ${PUMP_BASAL_INCREMENT}`)
      }
    }
  }

  // Vérifier cibles
  for (const target of settings.glucoseTargets) {
    if (target.targetGlucose < TARGET_MIN_MGDL || target.targetGlucose > TARGET_MAX_MGDL) {
      throw new Error(`Invalid glucose target: ${target.targetGlucose}`)
    }
  }
}
```

---

## 12. Ressources médicales

### Références d'apprentissage

- **ADA Standards of Care** : Recommandations officielles diabète
- **ISPAD Guidelines** : Pédiatrie
- **Pump Manufacturer** : Medtronic, Tandem, Insulet documentation
- **CGM Systems** : Dexcom, FreeStyle Libre documentation

### Formules de calcul

- **Total Daily Insulin (TDI)** = Basal + Bolus moyen
- **Basal percentage** : ~40-50% du TDI
- **Bolus percentage** : ~50-60% du TDI
- **ISF rough estimate** : 1700 rule (mg/dL) ou 94 rule (mmol/L)
- **ICR rough estimate** : 500 rule (mg/dL) ou 28 rule (mmol/L)

---

Dernière mise à jour : 2026-03-31 (Phase 0)
