# US-3362 — Section AGP 7 jours résumé (web)

> 📌 **patient-web** · Priorité **V1** · Satellite de `US-3356`

> ⏸️ **PAUSED** (Q10 session Samir 2026-05-13) — Bloqué par absence dauth patient web. US-2025 (mobile invite) = JWT 15min mono-usage, pas de session web long-vie. Cadrage différé.

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-3362` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **5** |
| **Persona** | Patient (🌐 Web) |
| **Dépendances** | US-3049 (profil AGP), US-3356 |
| **US parente** | `US-3356` |

---

## 📋 Contexte produit

Mini-rapport AGP 7 derniers jours sur le dashboard web. Vue synthétique des percentiles glycémiques sur la semaine — utile pour repérer rapidement des patterns. CTA 'Voir détail AGP' pour accéder au rapport complet 14j.

---

## 🎨 Composition

### Layout
- Header : titre + CTA 'Voir détail AGP'
- Graphique SVG percentiles 7 jours :
  - Bande 5-95% (claire)
  - Bande 25-75% (moyenne)
  - Médiane (ligne)
  - Zones cibles (70-180 mg/dL)
- Légende sous le graphique

### Cible UX
- Vue d'aperçu, pas analyse profonde
- Clic CTA → AGP complet 14j dédié

---

## ✅ Critères d'acceptation

### AC-1 — AGP 7j visible
```gherkin
Étant donné patient ouvre dashboard web
Quand section AGP se rend
Alors graphique percentiles 7j affiché avec zones cibles
```

### AC-2 — CTA vers détail
```gherkin
Étant donné patient clique 'Voir détail AGP'
Quand il valide
Alors navigation vers écran AGP complet 14j (US-3049)
```

### AC-3 — Légende claire
```gherkin
Étant donné section se charge
Quand elle se rend
Alors légende sous graphique : médiane, 25-75%, 5-95%
```

### AC-4 — Pas assez de données
```gherkin
Étant donné patient a <3 jours
Quand section se rend
Alors message 'Données insuffisantes - portez votre capteur 7+ jours'
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Minimum 3 jours de données CGM pour AGP significatif
- **RM-2** : Calcul percentiles côté serveur, cache Redis 1h
- **RM-3** : Zones cibles personnalisées (si configurées) utilisées dans le graphique

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/patient/me/agp?period=7d
  → { percentiles: { p5, p25, median, p75, p95 }, targetRange }
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | AGP 7j affiché |
| Données insuffisantes | Message pédagogique |
| Loading | Skeleton |

---

## 🧪 Tests prioritaires

- **Calcul percentiles** : valider avec dataset connu
- **Données insuffisantes** : tester avec 1-2 jours
- **Performance** : rendu <500ms

---

## 📦 DoD dashboard-spécifique

- [ ] AGP 7j correctement calculé
- [ ] Cas données insuffisantes géré
- [ ] CTA fonctionnel

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-3356
- US liée : US-3049

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
