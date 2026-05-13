# US-3361 — Section glycémie 24h détaillée (web)

> 📌 **patient-web** · Priorité **V1** · Satellite de `US-3356`

> ⏸️ **PAUSED** (Q10 session Samir 2026-05-13) — Bloqué par absence dauth patient web. US-2025 (mobile invite) = JWT 15min mono-usage, pas de session web long-vie. Cadrage différé.

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-3361` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **8** |
| **Persona** | Patient (🌐 Web) |
| **Dépendances** | US-3047, US-3356 |
| **US parente** | `US-3356` |

---

## 📋 Contexte produit

Section principale du dashboard patient web. Affiche la courbe glycémique 24h avec annotations événements (repas, bolus, activités), sélecteur période (24h/7j/14j/30j), et 4 métriques sous la courbe. Densité d'information bien supérieure au mobile pour analyse à froid.

---

## 🎨 Composition

### Layout
- Header : titre + sélecteur période (24h actif, 7j, 14j, 30j)
- Sub-header : grand chiffre glycémie actuelle + tendance + statut sync
- Courbe SVG 24h avec :
  - Zones cibles colorées (70-180 mg/dL ou personnalisé)
  - Annotations événements : icônes au-dessus de la courbe
  - Point actuel en surbrillance
  - Axes Y (mg/dL) et X (heures)
- 4 métriques en bas (grille 4 colonnes)

### Sélecteur période
- Pills segmented control
- Au changement : courbe rechargée + métriques recalculées

---

## ✅ Critères d'acceptation

### AC-1 — Courbe 24h détaillée
```gherkin
Étant donné patient ouvre dashboard web
Quand section glycémie se rend
Alors courbe 24h affichée avec zones cibles, annotations visibles
```

### AC-2 — Sélection période
```gherkin
Étant donné patient clique sur '7j'
Quand sélecteur change
Alors courbe rechargée pour 7 jours, métriques recalculées
```

### AC-3 — Hover sur point
```gherkin
Étant donné patient survole un point
Quand tooltip apparaît
Alors valeur exacte + heure + contexte événement
```

### AC-4 — Annotations événements
```gherkin
Étant donné repas/bolus saisis dans la journée
Quand courbe se rend
Alors icônes annotations visibles aux heures correspondantes
```

### AC-5 — 4 métriques
```gherkin
Étant donné courbe affiche 24h
Quand métriques calculées
Alors TIR + moyenne + CV + HbA1c estimée
```

### AC-6 — Cibles personnalisées
```gherkin
Étant donné patient a cibles spécifiques
Quand courbe se rend
Alors zones colorées reflètent ses cibles
```

### AC-7 — Performance grand volume
```gherkin
Étant donné patient sélectionne 30j
Quand courbe se charge
Alors rendu fluide même avec 8000+ points (downsampling)
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Downsampling pour périodes >7j (max 1000 points affichés)
- **RM-2** : Annotations événements limitées aux événements significatifs (>20g glucides)
- **RM-3** : Métriques recalculées côté serveur en cache Redis (TTL 5 min)
- **RM-4** : Conformité accessibilité : SVG avec description textuelle alternative

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/patient/me/glucose?range=24h&include=events
  → { points, annotations, metrics }
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default 24h | Courbe + annotations + 4 métriques |
| Période changée | Courbe rechargée, métriques mises à jour |
| Pas de données | Empty state 'Aucune donnée pour cette période' |
| Loading | Skeleton de la courbe |
| Erreur | Message d'erreur + bouton retry |

---

## 🧪 Tests prioritaires

- **Sélection période** : tester 24h, 7j, 14j, 30j
- **Hover/tooltip** : valider sur points et annotations
- **Downsampling** : valider performance >7j
- **Accessibilité** : SVG avec aria-label et description
- **Cross-browser** : Chrome, Firefox, Safari, Edge

---

## 📦 DoD dashboard-spécifique

- [ ] Sélecteur période fonctionnel
- [ ] Annotations événements correctes
- [ ] Métriques calculées exactement
- [ ] Performance 30j validée (<3s rendu)
- [ ] Accessibilité SVG conforme

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-3356
- US liée : US-3047

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
