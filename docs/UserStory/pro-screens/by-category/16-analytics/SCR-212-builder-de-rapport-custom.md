# SCR-212 — Builder de rapport custom

> 🟡 Priorité **V2** · 📄 Type **PAGE** · Catégorie **16-Analytics**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-212` |
| **Catégorie** | 16-Analytics |
| **Nom** | Builder de rapport custom |
| **Type** | PAGE |
| **Priorité** | **V2** |
| **Story points** | 13 |
| **Route Next.js** | `/analytics/report-builder` |

---

## 🎭 Personas concernés

ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Analytics

### Mène vers (enfants / sorties)
Génération PDF/Excel

---

## 🎨 États possibles

- `draft`
- `configuring`
- `generating`
- `ready`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Drag-drop indicateurs, filtres, période, format, export

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
ReportBuilder, IndicatorPicker, ExportConfig
```

### Route Next.js

```
/analytics/report-builder
```

### User Stories référencées

- US-2099 Rapports custom


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
- Index par catégorie : [`16-analytics/README.md`](README.md)
- Index par priorité : [`../by-priority/V2.md`](../by-priority/V2.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
