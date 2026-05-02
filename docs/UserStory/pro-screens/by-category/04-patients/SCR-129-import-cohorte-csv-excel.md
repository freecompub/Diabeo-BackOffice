# SCR-129 — Import cohorte (CSV/Excel)

> 🟡 Priorité **V2** · 💬 Type **MODAL** · Catégorie **04-Patients**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-129` |
| **Catégorie** | 04-Patients |
| **Nom** | Import cohorte (CSV/Excel) |
| **Type** | MODAL |
| **Priorité** | **V2** |
| **Story points** | 8 |
| **Route Next.js** | `/patients/import` |

---

## 🎭 Personas concernés

ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Liste patients (menu)

### Mène vers (enfants / sorties)
Mapping colonnes, Validation

---

## 🎨 États possibles

- `upload`
- `mapping`
- `validation-errors`
- `importing`
- `success`
- `error`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Drag-drop fichier, mapping colonnes auto + manuel, prévisualisation, gestion doublons

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
FileUpload, ColumnMapper, ImportPreview
```

### Route Next.js

```
/patients/import
```

### User Stories référencées

- US-2027 Import/export cohorte


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
- Index par priorité : [`../by-priority/V2.md`](../by-priority/V2.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
