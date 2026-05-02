# SCR-273 — Glucose chart (composant)

> 🟢 Priorité **MVP** · 🧩 Type **COMPONENT** · Catégorie **26-Composants**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-273` |
| **Catégorie** | 26-Composants |
| **Nom** | Glucose chart (composant) |
| **Type** | COMPONENT |
| **Priorité** | **MVP** |
| **Story points** | 13 |
| **Route Next.js** | `(component)` |

---

## 🎭 Personas concernés

Tab Glycémie, Dashboard, Workflow ajustement

---

## 🧭 Navigation

### Vient de (parents)
_Aucun_

### Mène vers (enfants / sorties)
_Aucun_

---

## 🎨 États possibles

- `loading`
- `with-data`
- `empty`
- `error`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Courbe interactive avec zones cibles colorées, hover détail, overlays événements

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
GlucoseChart, ChartOverlay, EventMarker
```

### Route Next.js

```
(component)
```

### User Stories référencées

- US-2030 Courbe glycémique


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
- Index par catégorie : [`26-composants/README.md`](README.md)
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
