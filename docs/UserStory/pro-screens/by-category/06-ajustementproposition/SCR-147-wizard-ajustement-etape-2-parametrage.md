# SCR-147 — Wizard ajustement — Étape 2 Paramétrage

> 🟢 Priorité **MVP** · 🧙 Type **WIZARD_STEP** · Catégorie **06-AjustementProposition**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-147` |
| **Catégorie** | 06-AjustementProposition |
| **Nom** | Wizard ajustement — Étape 2 Paramétrage |
| **Type** | WIZARD_STEP |
| **Priorité** | **MVP** |
| **Story points** | 13 |
| **Route Next.js** | `/patients/[id]/proposals/new/configure` |

---

## 🎭 Personas concernés

DOCTOR

---

## 🧭 Navigation

### Vient de (parents)
Étape 1

### Mène vers (enfants / sorties)
Étape 3

---

## 🎨 États possibles

- `default`
- `validation-error`
- `bounds-warning`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Modification schéma : nouvelles tranches IC/FS/basale + comparaison avant/après + impact estimé

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
ScheduleEditor, BeforeAfterDiff, BoundsValidator, RationaleInput
```

### Route Next.js

```
/patients/[id]/proposals/new/configure
```

### User Stories référencées

- US-2061
- US-2048 Bornes sécurité


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
- Index par catégorie : [`06-ajustementproposition/README.md`](README.md)
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
