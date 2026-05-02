# SCR-247 — Mode contextuel d'aide (?)

> 🟡 Priorité **V2** · 📋 Type **DRAWER** · Catégorie **21-AideSupport**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-247` |
| **Catégorie** | 21-AideSupport |
| **Nom** | Mode contextuel d'aide (?) |
| **Type** | DRAWER |
| **Priorité** | **V2** |
| **Story points** | 3 |
| **Route Next.js** | `(drawer)` |

---

## 🎭 Personas concernés

Tous

---

## 🧭 Navigation

### Vient de (parents)
Bouton ? sur chaque page

### Mène vers (enfants / sorties)
_Aucun_

---

## 🎨 États possibles

- `default`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Aide contextuelle à la page courante, raccourcis clavier, vidéo si dispo

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
ContextualHelp
```

### Route Next.js

```
(drawer)
```

### User Stories référencées

- _Aucune US directement référencée pour cet écran_


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
- Index par catégorie : [`21-aidesupport/README.md`](README.md)
- Index par priorité : [`../by-priority/V2.md`](../by-priority/V2.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
