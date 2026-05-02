# SCR-120 — KPI cabinet (synthèse)

> 🔵 Priorité **V1** · 🧩 Type **COMPONENT** · Catégorie **03-Dashboard**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-120` |
| **Catégorie** | 03-Dashboard |
| **Nom** | KPI cabinet (synthèse) |
| **Type** | COMPONENT |
| **Priorité** | **V1** |
| **Story points** | 5 |
| **Route Next.js** | `(component)` |

---

## 🎭 Personas concernés

DOCTOR, ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Dashboard médecin

### Mène vers (enfants / sorties)
Analytics détaillé

---

## 🎨 États possibles

- `default`
- `with-data`
- `loading`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Indicateurs : nb patients actifs, TIR moyen cohorte, urgences semaine, satisfaction

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
KpiGrid, MetricCard
```

### Route Next.js

```
(component)
```

### User Stories référencées

- US-2095 Indicateurs qualité
- US-2228 Stats cohorte urgences


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
- Index par catégorie : [`03-dashboard/README.md`](README.md)
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
