# SCR-193 — Bibliothèque programmes ETP

> 🟡 Priorité **V2** · 📄 Type **PAGE** · Catégorie **14-ETP**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-193` |
| **Catégorie** | 14-ETP |
| **Nom** | Bibliothèque programmes ETP |
| **Type** | PAGE |
| **Priorité** | **V2** |
| **Story points** | 5 |
| **Route Next.js** | `/admin/etp-programs` |

---

## 🎭 Personas concernés

DOCTOR, NURSE, ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Sidebar Admin

### Mène vers (enfants / sorties)
Édition programme, Application patient

---

## 🎨 États possibles

- `loading`
- `default`
- `empty (V1)`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Catalogue programmes structurés HAS : insulinothérapie, gestationnel, alimentation

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
ProgramsLibrary, ProgramCard
```

### Route Next.js

```
/admin/etp-programs
```

### User Stories référencées

- US-2255 Bibliothèque ETP


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
- Index par catégorie : [`14-etp/README.md`](README.md)
- Index par priorité : [`../by-priority/V2.md`](../by-priority/V2.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
