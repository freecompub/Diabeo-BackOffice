# SCR-122 — Filtres avancés patients

> 🟢 Priorité **MVP** · 📋 Type **DRAWER** · Catégorie **04-Patients**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-122` |
| **Catégorie** | 04-Patients |
| **Nom** | Filtres avancés patients |
| **Type** | DRAWER |
| **Priorité** | **MVP** |
| **Story points** | 5 |
| **Route Next.js** | `(drawer)` |

---

## 🎭 Personas concernés

DOCTOR, NURSE

---

## 🧭 Navigation

### Vient de (parents)
Liste patients

### Mène vers (enfants / sorties)
Liste filtrée

---

## 🎨 États possibles

- `default`
- `with-active-filters`
- `reset`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Pathologie, équilibre (HbA1c, TIR), alertes, mode actif (grossesse/pédia/Ramadan), tags, dispositifs

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
PatientFiltersPanel, FilterChip, MultiSelect
```

### Route Next.js

```
(drawer)
```

### User Stories référencées

- US-2016 Liste filtrable


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
- Index par catégorie : [`04-patients/README.md`](README.md)
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
