# Exemples cliniques anonymises

Ce document illustre les calculs et comportements du systeme avec des donnees fictives.

## Exemple 1 : Calcul de bolus standard (DT1)

**Contexte** : Patient DT1, pompe a insuline, repas de midi.

| Parametre | Valeur |
|-----------|--------|
| Glycemie actuelle | 1.80 g/L (180 mg/dL) |
| Glucides repas | 60 g |
| ICR (12h-14h) | 10 g/U |
| ISF (12h-14h) | 0.40 g/L/U (40 mg/dL/U) |
| Cible glycemique | 120 mg/dL |
| Methode | Pompe (arrondi 0.05U) |

**Calcul** :
```
Bolus repas     = 60 / 10 = 6.00 U
Correction      = max(0, (180 - 120) / 40) = 1.50 U
IOB             = 0 U (pas de bolus recent)
Total brut      = 6.00 + 1.50 = 7.50 U
Arrondi pompe   = 7.50 U (deja multiple de 0.05)
Plafonnement    = 7.50 U (< 25 U)
```

**Resultat** : `recommendedDose = 7.50 U`, `wasCapped = false`, `warnings = []`

## Exemple 2 : Bolus avec hypoglycemie

**Contexte** : Patient DT1, stylo, glycemie basse avant le dejeuner.

| Parametre | Valeur |
|-----------|--------|
| Glycemie actuelle | 0.60 g/L (60 mg/dL) |
| Glucides repas | 45 g |
| ICR | 12 g/U |
| ISF | 0.50 g/L/U |
| Cible | 110 mg/dL |
| Methode | Stylo (arrondi 0.5U) |

**Calcul** :
```
Bolus repas     = 45 / 12 = 3.75 U
Correction      = max(0, (60 - 110) / 50) = max(0, -1.0) = 0 U
Total brut      = 3.75 + 0 = 3.75 U
Arrondi stylo   = 4.0 U (arrondi a 0.5U superieur)
```

**Resultat** :
- `recommendedDose = 4.0 U`
- `requiresHypoTreatmentFirst = true`
- `warnings = ["hypoglycemia"]`
- Le systeme indique de traiter l'hypo avec 15-20g de glucides AVANT le bolus

## Exemple 3 : Profil glycemique sur 14 jours

**Contexte** : Patient DT2, 14 jours de donnees CGM.

| Metrique | Valeur | Interpretation |
|----------|--------|---------------|
| Lectures CGM | 3800 / 4032 attendues | Capture 94% (> 70% requis) |
| Glucose moyen | 1.42 g/L (142 mg/dL) | Moderement eleve |
| GMI | 6.70% | Controle acceptable |
| CV | 32% | Variabilite stable (< 36%) |
| TIR | 65% | Sous la cible de 70% |
| Hypo (< 70 mg/dL) | 3% | Acceptable (< 4%) |
| Hypo severe (< 54) | 0.5% | Acceptable (< 1%) |
| Eleve (180-250) | 22% | Acceptable (< 25%) |
| Hyper (> 250) | 9.5% | A surveiller (cible < 5%) |
| Qualite | "good" | TIR >= 50%, CV <= 36% |

## Exemple 4 : Proposition d'ajustement ISF

**Contexte** : Analyse sur 14 jours, creneau 8h-12h.

| Donnee | Valeur |
|--------|--------|
| ISF actuel | 0.40 g/L/U |
| Corrections sur la periode | 8 evenements |
| Glycemie post-correction moyenne | 2.10 g/L |
| Cible | 1.20 g/L |
| Ecart | +75% au-dessus de la cible |

**Analyse** :
```
errorPercent = ((2.10 - 1.20) / 1.20) * -100 = -75%
clampedChange = max(-20, min(20, -75)) = -20%  (plafonne)
proposedValue = 0.40 * (1 + (-20/100)) = 0.32 g/L/U
```

**Proposition** :
- `parameterType = "insulinSensitivityFactor"`
- `reason = "isfTooHigh"` (patient sur-corrige, ISF trop eleve)
- `currentValue = 0.40`, `proposedValue = 0.32`
- `changePercent = -20%`
- `confidence = "medium"` (8 evenements, entre 6-10)

Le medecin peut accepter (avec application immediate) ou rejeter.

## Exemple 5 : Diabete gestationnel — seuils differents

**Contexte** : Patiente GD, 28 semaines de grossesse.

| Parametre | Standard (DT1/DT2) | Gestationnel (GD) |
|-----------|--------------------|--------------------|
| Hypo severe | < 0.54 g/L | < 0.54 g/L |
| Hypo | < 0.70 g/L | < 0.63 g/L |
| In Range max | 1.80 g/L | 1.40 g/L |
| Eleve | 2.50 g/L | 2.00 g/L |

Le systeme applique automatiquement les defaults GD quand `pathology = "GD"`.
Cela signifie qu'une glycemie de 1.60 g/L :
- DT1/DT2 : classee "In Range"
- GD : classee "Elevated" — necessite une attention clinique

## Exemple 6 : Detection d'episode hypoglycemique

**Donnees CGM** (lectures toutes les 5 minutes) :

| Heure | Valeur (g/L) | Classification |
|-------|-------------|----------------|
| 03:00 | 0.85 | Normal |
| 03:05 | 0.72 | Normal |
| 03:10 | 0.65 | Hypo Level 1 |
| 03:15 | 0.58 | Hypo Level 1 |
| 03:20 | 0.52 | Hypo Level 2 |
| 03:25 | 0.55 | Hypo Level 1 |
| 03:30 | 0.68 | Hypo Level 1 |
| 03:35 | 0.75 | Normal |

**Resultat** :
- Episode detecte : 03:10 - 03:30 (5 lectures consecutives, 20 min)
- Severite : Level 2 (nadir = 0.52 g/L < 0.54)
- Duree : 20 minutes
