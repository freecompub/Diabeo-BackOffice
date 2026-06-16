# Logique clinique — Calcul de bolus

## References medicales

- ADA Standards of Medical Care in Diabetes (2025)
- Consensus international TIR (Battelino et al., Diabetes Care 2019)
- GMI formula (Bergenstal et al., Diabetes Care 2018)

## Bornes cliniques (CLINICAL_BOUNDS)

| Parametre | Min | Max | Unite | Source |
|-----------|-----|-----|-------|--------|
| ISF | 0.10 | 1.00 | g/L/U | Widened for insulin-resistant T2D |
| ISF | 10 | 100 | mg/dL/U | 1800 Rule range |
| ICR | 3.0 | 30.0 | g/U | Widened for pediatric + resistant |
| Basal rate | 0.05 | 5.0 | U/h | Lowered from 10 (safety) |
| Max single bolus | 25.0 | — | U | Safety cap |
| Insulin action | 3.5 | 5.0 | h | Rapid-acting pharmacokinetics |

## Formule de calcul

```
1. Bolus repas     = carbsGrams / ICR (gramsPerUnit)
2. Correction brute = (currentGlucose_mgdl - targetGlucose_mgdl) / ISF_mgdl
3. IOB adjustment  = min(IOB, max(0, correction brute))  [si considerIOB = true]
4. Correction nette = max(0, correction brute - IOB adjustment)
5. Total brut      = bolus repas + correction nette
6. Arrondi device  = roundForDevice(total, deliveryMethod)
7. Plafonnement    = min(arrondi, 25.0 U)
```

### Arrondi par type d'appareil

| Methode | Increment | Formule |
|---------|-----------|---------|
| Pompe (pump) | 0.05 U | `Math.round(dose * 20) / 20` |
| Stylo (manual) | 0.5 U | `Math.round(dose * 2) / 2` |

## Warnings medicaux

| Warning | Condition | Action |
|---------|-----------|--------|
| severeHypoglycemia | glucose < 54 mg/dL (0.54 g/L) | `requiresHypoTreatmentFirst = true` |
| hypoglycemia | glucose < 70 mg/dL (0.70 g/L) | `requiresHypoTreatmentFirst = true` |
| severeHyperglycemia | glucose > 250 mg/dL (2.50 g/L) | Warning only |
| criticalHighGlucose | glucose > 400 mg/dL (4.00 g/L) | Warning only |
| exceedsMaximumBolus | dose brute > 25 U | Dose plafonnee, flag `wasCapped` |

**Important** : Si `requiresHypoTreatmentFirst = true`, le patient doit traiter l'hypoglycemie (15-20g de glucides) AVANT de considerer le bolus repas. Les glucides de traitement ne doivent pas etre boluses.

## Selections des creneaux horaires

Les parametres ISF, ICR et basal sont definis par creneaux horaires (0-23h). La selection se fait par `findSlotForHour`, sur intervalle demi-ouvert `[startHour, endHour)` :

```typescript
// Support du passage minuit (ex: 22h -> 6h)
if (startHour <= endHour) {
  return hour >= startHour && hour < endHour
} else {
  return hour >= startHour || hour < endHour
}
```

**Securite clinique (fail-closed)** : si aucun creneau ne couvre l'heure
courante, `findSlotForHour` renvoie `undefined` et l'appelant **leve** une
erreur (`"No ISF/ICR slot found for current hour"`) **avant** tout calcul de
dose. Aucun fallback, aucune dose calculee sur une heure non couverte par la
configuration. Les chevauchements de creneaux sont par ailleurs rejetes a
l'ecriture (HR-2, `hasTimeSlotOverlap`), garantissant l'unicite du creneau
selectionne.

## Analytics glycemiques

### GMI (Glucose Management Indicator)

```
GMI (%) = 3.31 + 0.02392 x moyenneGlucose(mg/dL)
```

Remplace l'ancienne formule eA1c par consensus international 2019.

### Time In Range (TIR) — 5 zones

| Zone | Seuil (g/L) | Seuil (mg/dL) | Cible ADA |
|------|-------------|---------------|-----------|
| Hypo severe (Level 2) | < 0.54 | < 54 | < 1% |
| Hypo (Level 1) | 0.54 - 0.70 | 54 - 70 | < 4% |
| In Range | 0.70 - 1.80 | 70 - 180 | > 70% |
| Eleve (Level 1) | 1.80 - 2.50 | 180 - 250 | < 25% |
| Hyper (Level 2) | > 2.50 | > 250 | < 5% |

### Defaults GD (diabete gestationnel)

| Parametre | Standard | GD |
|-----------|----------|-----|
| low | 0.70 g/L | 0.63 g/L |
| ok | 1.80 g/L | 1.40 g/L |
| high | 2.50 g/L | 2.00 g/L |

### Detection des episodes hypoglycemiques

- Minimum 3 lectures consecutives < seuil (>= 15 min pour CGM 5 min)
- Gap maximum 30 minutes entre lectures
- Severite : Level 1 (< 70 mg/dL) ou Level 2 (< 54 mg/dL)

### Qualite TIR

| Qualite | TIR | CV |
|---------|-----|-----|
| Excellent | >= 70% | <= 36% |
| Good | >= 50% | 36-40% |
| Needs Improvement | < 50% | > 40% |
| Concerning Hypo | hypo > 5% | — |
| Concerning Hyper | hyper > 25% | — |

### Capture CGM minimale

70% de capture sur la periode analysee est requis (consensus ADA 2019). En dessous, un warning `insufficientCgmCapture` est emis.

### Plancher d'affichage CGM & signal de fraichesse (securite clinique)

`getCgmEntries` exclut les valeurs hors plage capteur affichable : `< 0.40 g/L`
(40 mg/dL) et `> 5.00 g/L` (500 mg/dL). **Attention** : la BDD stocke une plage
plus large (`CHECK 0.20-6.00 g/L`, `cgm_partitioning.sql`). Une valeur numerique
mesuree entre **0.20 et 0.40 g/L est donc une hypoglycemie severe reelle**, pas
seulement un artefact « LOW » capteur.

Risque : un releve hors plage **recent** (hypo severe / capteur LOW) exclu de la
serie peut laisser un releve benin plus ancien passer pour le « dernier releve »
sans declencher `stale` -> fausse reassurance.

Garde-fou (`src/lib/cgm-freshness.ts`, `glycemiaService.getLatestCgmFreshness`) :
le releve brut le plus recent (sans filtre de valeur) est croise avec le dernier
releve affiche. S'il est hors plage **et plus recent** (ou s'il n'y a aucun
releve affichable), un caveat est leve : `recentOutOfRange = "low" | "high"`.

- Affichage : dossier medecin (onglet Glycemie), dashboard patient, et header
  HTTP additif `X-CGM-Recent-Out-Of-Range` sur `/api/cgm` et
  `/api/patients/[id]/cgm`.
- Consigne patient (LOW) : confirmer au doigt (BGM) avant d'agir + auto-traiter
  si confirme. Variante HIGH : confirmer au doigt uniquement (jamais d'incitation
  a une correction insuline non supervisee).
- **Limitation connue** : le caveat ne distingue pas encore une valeur numerique
  sous-plancher (20-40 mg/dL, hypo mesuree) d'un flag « LOW » capteur. L'action
  (confirmer au doigt) est correcte dans les deux cas.

#### Agregats : plage valide complete (0.20-6.00 g/L)

Distinction importante entre **affichage** et **agregats** :

- **Serie graphique** (`getCgmEntries`) : plancher d'affichage 0.40-5.00 g/L +
  caveat de fraicheur ci-dessus.
- **Agregats** (`analytics.service` : moyenne, CV, GMI, TIR, AGP, episodes hypo) :
  plage **physiologique valide** 0.20-6.00 g/L (= CHECK base), constantes
  `CGM_AGG_MIN_GL` / `CGM_AGG_MAX_GL`. Les hypo severes reelles mesurees sous le
  plancher d'affichage (0.20-0.40) sont donc **comptees** (bucket `severeHypo` du
  TIR, et baissent la moyenne) — sinon la charge hypoglycemique serait
  **sous-estimee** (consensus ADA/Battelino : tout releve CGM valide compte dans
  le TIR ; les valeurs « LOW » capteur sont comptees dans la zone la plus basse).

## Propositions d'ajustement

### Algorithme

Pour chaque creneau ISF/ICR et pour le debit basal :
1. Analyse des corrections/repas sur la periode (7/14/30 jours)
2. Comparaison glucose post-correction/post-prandiale vs cible
3. Si ecart > 2% sur N evenements : proposition d'ajustement
4. Variation plafonnee a +/- 20% par cycle

### Niveaux de confiance

| Confiance | Evenements | Signification |
|-----------|-----------|---------------|
| low | 3-5 | Tendance detectee, pas statistiquement robuste |
| medium | 6-10 | Analyse significative |
| high | > 10 | Recommandation fiable |

### Workflow

```
Algorithme genere ProposalCandidate
  → AdjustmentProposal (status: pending)
  → Revue par DOCTOR
  → Accept (applique immediat optionnel) ou Reject
  → Si accept + applyImmediately: mise a jour ISF/ICR/basal en base
```
