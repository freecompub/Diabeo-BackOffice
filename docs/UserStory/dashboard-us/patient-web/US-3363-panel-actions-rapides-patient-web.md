# US-3363 — Panel actions rapides patient (web)

> 📌 **patient-web** · Priorité **V1** · Satellite de `US-3356`

> ⏸️ **PAUSED** (Q10 session Samir 2026-05-13) — Bloqué par absence dauth patient web. US-2025 (mobile invite) = JWT 15min mono-usage, pas de session web long-vie. Cadrage différé.

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-3363` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **3** |
| **Persona** | Patient (🌐 Web) |
| **Dépendances** | US-3044, US-3062, US-3078, US-3356 |
| **US parente** | `US-3356` |

---

## 📋 Contexte produit

Panel à droite du dashboard patient web avec 4 actions rapides : saisir glycémie, ajouter repas, calculer bolus, exporter rapport. Équivalent web du FAB mobile, mais visible en permanence sur écran ≥1024px.

---

## 🎨 Composition

### Layout
- Header : 'Actions rapides' + icône
- 4 boutons verticaux :
  - 💧 Saisir une glycémie
  - 🍽️ Ajouter un repas
  - 💉 Calculer un bolus
  - 📤 Exporter un rapport
- Tap-target full-width, icône à gauche + label

### Différences mobile/web
- Mobile : FAB (geste rapide, 1 tap pour bottom sheet)
- Web : panel permanent (lecture rapide actions disponibles)

---

## ✅ Critères d'acceptation

### AC-1 — Panel visible permanent
```gherkin
Étant donné patient ouvre dashboard web
Quand panel se rend
Alors 4 boutons visibles en permanence à droite
```

### AC-2 — Saisir glycémie
```gherkin
Étant donné patient clique 'Saisir une glycémie'
Quand il valide
Alors modal de saisie glycémie s'ouvre
```

### AC-3 — Ajouter repas
```gherkin
Étant donné patient clique 'Ajouter un repas'
Quand il valide
Alors wizard ajout repas s'ouvre
```

### AC-4 — Calculer bolus
```gherkin
Étant donné patient clique 'Calculer un bolus'
Quand il valide
Alors calculateur bolus s'ouvre
```

### AC-5 — Exporter rapport
```gherkin
Étant donné patient clique 'Exporter un rapport'
Quand il valide
Alors modal configuration rapport s'ouvre
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Panel toujours visible (pas de gesture, pas de tap pour ouvrir)
- **RM-2** : Actions équivalent FAB mobile mais sans contrainte d'espace
- **RM-3** : Couleur teal cohérente avec design system

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

Pas d'API spécifique — navigation pure vers les modals existants.

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | 4 boutons visibles |

---

## 🧪 Tests prioritaires

- **Navigation** : chaque bouton ouvre le bon écran
- **Accessibilité** : boutons accessibles clavier
- **Responsive** : visible ≥1024px, caché ou repositionné <1024px

---

## 📦 DoD dashboard-spécifique

- [ ] 4 actions fonctionnelles
- [ ] Accessibilité clavier OK
- [ ] Design system respecté

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-3356

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
