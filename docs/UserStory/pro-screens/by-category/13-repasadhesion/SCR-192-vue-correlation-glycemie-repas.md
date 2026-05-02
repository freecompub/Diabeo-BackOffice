# SCR-192 — Vue corrélation glycémie ↔ repas

> 🔵 Priorité **V1** · 📄 Type **PAGE** · Catégorie **13-RepasAdhesion**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-192` |
| **Catégorie** | 13-RepasAdhesion |
| **Nom** | Vue corrélation glycémie ↔ repas |
| **Type** | PAGE |
| **Priorité** | **V1** |
| **Story points** | 8 |
| **Route Next.js** | `/patients/[id]/glucose-meal-correlation` |

---

## 🎭 Personas concernés

DOCTOR, NURSE

---

## 🧭 Navigation

### Vient de (parents)
Tab repas, Tab glycémie

### Mène vers (enfants / sorties)
_Aucun_

---

## 🎨 États possibles

- `loading`
- `with-data`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Vue croisée auto : pour chaque repas, glycémie pré/post, bolus, comparaison prédiction

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
CorrelationChart, BolusPredictionDiff
```

### Route Next.js

```
/patients/[id]/glucose-meal-correlation
```

### User Stories référencées

- US-2254 Contextualisation


---

## ✅ Définition de Done (écran)

### Design
- [ ] Wireframe basse fidélité validé
- [ ] Maquette haute fidélité (Figma) validée par PO
- [ ] Tous les états listés ci-dessus sont designés
- [ ] Variantes responsive (≥1024px / 768px-1024px / <768px) si applicable
- [ ] Conformité design system Diabeo (Sérénité Active)
- [ ] Accessibility review : contraste, taille texte, focus order
- [ ] Mode sombre testé si applicable

### Développement
- [ ] Composants React implémentés (cf liste ci-dessus)
- [ ] Route Next.js fonctionnelle
- [ ] Tous les états gérés (loading, empty, error, success...)
- [ ] RBAC appliqué (cf US référencées)
- [ ] Tests E2E Playwright sur scénario nominal
- [ ] Tests d'accessibilité axe-core verts (0 critique)
- [ ] Performance : LCP < 2.5s, INP < 200ms (si page)
- [ ] Internationalisation FR + AR (RTL) si UI

### Validation
- [ ] Code review approuvée
- [ ] Validation produit / PO
- [ ] Validation healthcare-security-auditor si écran sensible

---

## 🔗 Ressources

- Cartographie complète : [`README.md`](../README.md)
- Index par catégorie : [`13-repasadhesion/README.md`](README.md)
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
