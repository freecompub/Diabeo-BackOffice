# SCR-186 — Recommandations changement matériel

> 🟡 Priorité **V2** · 🗂️ Type **PANEL** · Catégorie **12-Dispositifs**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-186` |
| **Catégorie** | 12-Dispositifs |
| **Nom** | Recommandations changement matériel |
| **Type** | PANEL |
| **Priorité** | **V2** |
| **Story points** | 3 |
| **Route Next.js** | `(panel)` |

---

## 🎭 Personas concernés

DOCTOR

---

## 🧭 Navigation

### Vient de (parents)
Fiche patient (tab), Dashboard

### Mène vers (enfants / sorties)
Pré-remplissage ordonnance

---

## 🎨 États possibles

- `empty`
- `with-suggestions`
- `applied`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Suggestions auto : capteur fin de vie, batterie faible. Pré-remplit prochaine ordonnance.

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
DeviceRecommendations, OrderPrefill
```

### Route Next.js

```
(panel)
```

### User Stories référencées

- US-2246 Reco changement


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
- Index par catégorie : [`12-dispositifs/README.md`](README.md)
- Index par priorité : [`../by-priority/V2.md`](../by-priority/V2.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
