# SCR-194 — Édition programme ETP

> 🟡 Priorité **V2** · 📄 Type **PAGE** · Catégorie **14-ETP**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-194` |
| **Catégorie** | 14-ETP |
| **Nom** | Édition programme ETP |
| **Type** | PAGE |
| **Priorité** | **V2** |
| **Story points** | 8 |
| **Route Next.js** | `/admin/etp-programs/[id]/edit` |

---

## 🎭 Personas concernés

DOCTOR (coordinateur ETP), ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Bibliothèque ETP

### Mène vers (enfants / sorties)
Sauvegarde, publication

---

## 🎨 États possibles

- `draft`
- `editing`
- `validating`
- `published`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Modules, durée, quiz, supports, cadre HAS

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
ProgramEditor, ModuleEditor
```

### Route Next.js

```
/admin/etp-programs/[id]/edit
```

### User Stories référencées

- US-2255


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
