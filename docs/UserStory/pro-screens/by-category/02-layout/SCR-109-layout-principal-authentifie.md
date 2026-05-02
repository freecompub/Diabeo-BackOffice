# SCR-109 — Layout principal authentifié

> 🟢 Priorité **MVP** · 🏗️ Type **LAYOUT** · Catégorie **02-Layout**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-109` |
| **Catégorie** | 02-Layout |
| **Nom** | Layout principal authentifié |
| **Type** | LAYOUT |
| **Priorité** | **MVP** |
| **Story points** | 5 |
| **Route Next.js** | `(layout)` |

---

## 🎭 Personas concernés

Tous rôles authentifiés

---

## 🧭 Navigation

### Vient de (parents)
_Aucun_

### Mène vers (enfants / sorties)
Toutes pages internes

---

## 🎨 États possibles

- `default`
- `mode dégradé (offline)`
- `maintenance`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Topbar (logo + recherche + notifications + avatar), Sidebar nav (responsive collapse)

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
AppShell, TopBar, SideNav, NotificationCenter
```

### Route Next.js

```
(layout)
```

### User Stories référencées

- US-2001 Login
- US-2012 RBAC


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
- Index par catégorie : [`02-layout/README.md`](README.md)
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
