# SCR-175 — Workflow transition adulte 16-18 ans

> 🟡 Priorité **V2** · 📄 Type **PAGE** · Catégorie **10-ModesContextuels**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-175` |
| **Catégorie** | 10-ModesContextuels |
| **Nom** | Workflow transition adulte 16-18 ans |
| **Type** | PAGE |
| **Priorité** | **V2** |
| **Story points** | 8 |
| **Route Next.js** | `/patients/[id]/transition` |

---

## 🎭 Personas concernés

DOCTOR, ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Fiche patient pédiatrique

### Mène vers (enfants / sorties)
Compte adulte autonome

---

## 🎨 États possibles

- `init`
- `transferring-rights`
- `validating`
- `completed`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Période transition, transfert progressif droits parent → ado, validation finale

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
TransitionWizard, RightsTransferUi
```

### Route Next.js

```
/patients/[id]/transition
```

### User Stories référencées

- US-2235 Transition adulte


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
- Index par catégorie : [`10-modescontextuels/README.md`](README.md)
- Index par priorité : [`../by-priority/V2.md`](../by-priority/V2.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
