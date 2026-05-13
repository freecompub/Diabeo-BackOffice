# US-2404 — Section KPI cabinet 14j (médecin)

> 📌 **medecin** · Priorité **V1** · Satellite de `US-2400`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2404` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **5** |
| **Persona** | DOCTOR, NURSE |
| **Dépendances** | US-2150 (analytics cabinet), US-2400 |
| **US parente** | `US-2400` |

---

## 📋 Contexte produit

Section bas du dashboard médecin avec 4 KPI cabinet sur les 14 derniers jours : patients actifs, TIR moyen, urgences semaine, propositions en attente. Vue agrégée pour donner un pouls global au médecin. Cliquables pour drill-down vers Analytics.

---

## 🎨 Composition

### Layout
- Header : icône chart-line + 'KPI cabinet · 14 derniers jours'
- 4 cards KPI en grille 4 colonnes :
  - Patients actifs (+8 ce mois)
  - TIR moyen (+2 pts ↗)
  - Urgences semaine (+1 vs sem-1)
  - Propositions (en attente)
- Chaque KPI :
  - Label
  - Grand chiffre
  - Évolution (tendance avec flèche)
  - Tap = drill-down Analytics

---

## ✅ Critères d'acceptation

### AC-1 — 4 KPI affichés
```gherkin
Étant donné médecin consulte le dashboard
Quand section KPI se rend
Alors 4 cards avec chiffres et tendances
```

### AC-2 — Tendance calculée
```gherkin
Étant donné TIR moyen a augmenté de 2pts en 14j
Quand card TIR se rend
Alors +2 pts ↗ (couleur verte)
```

### AC-3 — Tap = drill-down
```gherkin
Étant donné médecin clique KPI patients actifs
Quand il valide
Alors page Analytics filtrée s'ouvre
```

### AC-4 — Calcul agrégé exact
```gherkin
Étant donné data backend
Quand section calcule
Alors valeurs exactes avec mise en cache Redis 10min
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Cache Redis 10 min pour KPI (calcul coûteux)
- **RM-2** : Évolution calculée en comparaison avec période précédente équivalente
- **RM-3** : Couleur évolution : vert si amélioration clinique, rouge si dégradation, gris si neutre
- **RM-4** : Périmètre cabinet (pas seulement médecin) pour TIR moyen, patients actifs

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/medecin/kpi?period=14d
  → { activePatients, avgTir, weekUrgencies, pendingProposals, trends }
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | 4 KPI avec valeurs et tendances |
| Loading | Skeleton 4 cards |
| Erreur | Message + retry sur chaque KPI |

---

## 🧪 Tests prioritaires

- **Calcul agrégé** : valider avec dataset connu
- **Tendances** : tester améliorations / dégradations / neutres
- **Cache** : valider TTL 10 min
- **Drill-down** : navigation correcte vers Analytics

---

## 📦 DoD dashboard-spécifique

- [ ] 4 KPI exacts validés par PO
- [ ] Tendances calculées correctement
- [ ] Couleurs cohérentes (vert/rouge/gris)
- [ ] Cache Redis configuré

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2400
- US liée : US-2150

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
