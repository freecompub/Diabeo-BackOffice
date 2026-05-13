# US-3357 — Card glycémie live (mobile)

> 📌 **patient-mobile** · Priorité **MVP** · Satellite de `US-3355`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-3357` |
| **Type** | Composant satellite |
| **Priorité** | **MVP** |
| **Story points** | **8** |
| **Persona** | Patient (📱 iOS + Android) |
| **Dépendances** | US-3046 (pairing CGM), US-3047 (dashboard glycémie temps réel), US-3355 (dashboard mobile) |
| **US parente** | `US-3355` |

---

## 📋 Contexte produit

Composant central du dashboard patient mobile. Affiche la glycémie actuelle en grand chiffre (44pt), avec flèche de tendance, statut de connexion CGM, et mini-courbe 6h. Mise à jour temps réel via Bluetooth quand l'app est au premier plan, sync différée en arrière-plan.

Défi technique principal : afficher la dernière valeur connue en <1s au cold start (cache local).

---

## 🎨 Composition

### Layout vertical
- Header : 'Glycémie maintenant' + timestamp + icône Bluetooth
- Grand chiffre 44pt + unité 13pt (mg/dL ou mmol/L selon préférence)
- Flèche tendance + descripteur ('↗ stable haute', '→ stable', '↘ baisse rapide')
- Mini-courbe 6h avec zones cibles colorées personnalisées
- Footer : 2 micro-stats (TIR 24h, bolus du jour)

### Animations
- Pulse léger à chaque nouvelle valeur Bluetooth
- Transition douce du chiffre (Animatable iOS / Compose Android)

---

## ✅ Critères d'acceptation

### AC-1 — Cache local <1s
```gherkin
Étant donné patient ouvre app après cold start
Quand card se charge
Alors dernière glycémie (cache) affichée en <1s, sync background actualise
```

### AC-2 — Flèche tendance calculée
```gherkin
Étant donné 3 mesures récentes disponibles
Quand card calcule
Alors flèche selon convention Dexcom/Abbott : ↑↑ si +3 mg/dL/min, ↑ si +2, etc.
```

### AC-3 — Zones cibles personnalisées
```gherkin
Étant donné patient a cibles spécifiques (70-180)
Quand mini-courbe se rend
Alors zones cibles colorées reflètent ses cibles
```

### AC-4 — Unités selon préférence
```gherkin
Étant donné patient a choisi mmol/L
Quand card affiche la valeur
Alors valeur en mmol/L (conversion ×0.0555)
```

### AC-5 — Indicateur sync CGM
```gherkin
Étant donné CGM connecté Bluetooth
Quand card affiche statut
Alors icône Bluetooth verte + 'sync il y a Xs/min'
```

### AC-6 — Capteur expiré J-1
```gherkin
Étant donné capteur arrive à expiration
Quand card se rend
Alors petit indicateur 'capteur J-1' visible
```

### AC-7 — Mode grossesse
```gherkin
Étant donné patient en mode grossesse
Quand card se rend
Alors cibles obstétriques strictes utilisées (63-95 à jeun)
```

### AC-8 — Vibration haptique
```gherkin
Étant donné nouvelle valeur Bluetooth
Quand device reçoit
Alors vibration haptique légère selon préférences
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Conversion d'unités mg/dL ↔ mmol/L stricte (facteur 0.0555 ± précision)
- **RM-2** : Calcul de tendance basé sur 3 mesures consécutives minimum
- **RM-3** : Zones cibles personnalisées récupérées depuis profil utilisateur (sync backend)
- **RM-4** : Cache local glycémie 30j minimum (offline use)
- **RM-5** : Pas d'affichage de tendance si données <3 mesures ou intervalle >15min

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/patient/me/glucose/latest
  → { value, unit, timestamp, trend, source: 'CGM' | 'manual' }

GET /api/patient/me/glucose?range=6h
  → courbe 6h

WS /api/patient/me/glucose/stream (foreground only)
  → événements new measurement
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default (donnée récente <5min) | Grand chiffre + tendance + courbe |
| Donnée stale (5-30min) | Couleur grisée + 'Donnée non récente' |
| Donnée très stale (>30min) | Icône warning + 'Vérifiez votre capteur' |
| Pas de donnée | Empty state + CTA 'Connecter un capteur' |
| Hypo en cours | Couleur rouge + alerte intégrée |
| Hyper en cours | Couleur orange + alerte intégrée |
| Loading | Skeleton avec chiffre placeholder |

---

## 🧪 Tests prioritaires

- **Cache local** : ouverture cold start avec donnée en cache → affichage <1s
- **Tendance** : valider calcul avec différentes combinaisons de 3 mesures
- **Unités** : vérifier conversion stricte mg/dL ↔ mmol/L
- **Cibles personnalisées** : tester avec différentes configurations
- **Foreground/background** : valider sync différenciée

> Plan de test détaillé dans `docs/testing/baseline.md`.

---

## 📦 DoD dashboard-spécifique

- [ ] Cache local <1s validé (Xcode Instruments + Android Profiler)
- [ ] Conversion d'unités exacte testée (cas limites)
- [ ] Tendance calculée correctement (cas réels)
- [ ] iOS + Android testés sur 3 devices chacun
- [ ] AuditLog création pour accès donnée glycémique

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-3355
- US liées : US-3046 (pairing CGM), US-3047 (dashboard glycémie)
- Cartographie écran : SCR-P-230

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
