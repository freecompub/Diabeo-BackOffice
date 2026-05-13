# US-2406 — KPI 'Ma journée' infirmier

> 📌 **infirmier** · Priorité **V1** · Satellite de `US-2405`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2406` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **5** |
| **Persona** | NURSE |
| **Dépendances** | US-2500 (calendrier RDV), US-2405 |
| **US parente** | `US-2405` |

---

## 📋 Contexte produit

Section en haut du dashboard infirmier — 4 chiffres synthétiques pour donner immédiatement l'ampleur de la journée : RDV à préparer, patients à relancer, mesures à saisir, items avant 12h. Permet à l'infirmier de voir en 1s la charge de sa journée.

---

## 🎨 Composition

### Layout
- Background violet clair (#EEEDFE) — couleur dominante infirmier
- Grid 4 colonnes
- Chaque KPI :
  - Label (10pt)
  - Grand chiffre (22pt)
- Pas de tendance (vue absolue du jour)

### Cible UX
- Lecture en <1s à l'arrivée le matin
- Vue absolue, pas comparative
- Tap chaque KPI → liste correspondante

---

## ✅ Critères d'acceptation

### AC-1 — 4 KPI affichés
```gherkin
Étant donné infirmier ouvre dashboard
Quand section se rend
Alors 4 chiffres visibles immédiatement
```

### AC-2 — Tap → liste
```gherkin
Étant donné infirmier clique KPI 'RDV à préparer'
Quand il valide
Alors liste filtrée des RDV à préparer s'ouvre
```

### AC-3 — MAJ après action
```gherkin
Étant donné infirmier complète une tâche
Quand compteur 'Avant 12h' décrémente
Alors valeurs mises à jour en <2s
```

### AC-4 — Calcul exact 'Avant 12h'
```gherkin
Étant donné il est 8h, et 9 items sont avant 12h
Quand section calcule
Alors 'Avant 12h' = 9
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Recalcul à chaque action utilisateur (no cache lourd)
- **RM-2** : Mode multi-médecins : KPI agrège les patients des médecins assistés
- **RM-3** : Couleur violette cohérente avec dashboard infirmier

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/infirmier/kpi-day
  → { rdvToPrepare, patientsToRecall, measuresToInput, beforeNoon }
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | 4 chiffres affichés |
| Loading | Skeleton 4 chiffres |

---

## 🧪 Tests prioritaires

- **Recalcul après action** : valider <2s
- **Multi-médecins** : tester avec NURSE assistant 2 médecins
- **Calcul 'Avant 12h'** : valider selon heure courante

---

## 📦 DoD dashboard-spécifique

- [ ] 4 KPI exacts
- [ ] MAJ rapide après action
- [ ] Multi-médecins testé

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2405

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
