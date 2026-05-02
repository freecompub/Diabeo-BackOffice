# SCR-223 — Paramètres cabinet

> 🔵 Priorité **V1** · 📄 Type **PAGE** · Catégorie **18-Admin**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-223` |
| **Catégorie** | 18-Admin |
| **Nom** | Paramètres cabinet |
| **Type** | PAGE |
| **Priorité** | **V1** |
| **Story points** | 5 |
| **Route Next.js** | `/admin/cabinet` |

---

## 🎭 Personas concernés

ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Sidebar Admin

### Mène vers (enfants / sorties)
_Aucun_

---

## 🎨 États possibles

- `default`
- `editing`
- `saving`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Identité cabinet (nom, adresse, FINESS), logo, branding, fuseau, devise

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
CabinetSettings, BrandingEditor
```

### Route Next.js

```
/admin/cabinet
```

### User Stories référencées

- US-2147 Paramètres cabinet


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
- Index par catégorie : [`18-admin/README.md`](README.md)
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
