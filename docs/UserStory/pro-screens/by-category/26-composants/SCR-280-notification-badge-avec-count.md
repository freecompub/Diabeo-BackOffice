# SCR-280 — Notification badge (avec count)

> 🟢 Priorité **MVP** · 🧩 Type **COMPONENT** · Catégorie **26-Composants**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-280` |
| **Catégorie** | 26-Composants |
| **Nom** | Notification badge (avec count) |
| **Type** | COMPONENT |
| **Priorité** | **MVP** |
| **Story points** | 1 |
| **Route Next.js** | `(component)` |

---

## 🎭 Personas concernés

Topbar, sidebar items

---

## 🧭 Navigation

### Vient de (parents)
_Aucun_

### Mène vers (enfants / sorties)
_Aucun_

---

## 🎨 États possibles

- `default`
- `with-count`
- `with-pulse-animation (urgence)`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Badge rouge avec count, animation si urgence

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
NotificationBadge
```

### Route Next.js

```
(component)
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
- Index par catégorie : [`26-composants/README.md`](README.md)
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
