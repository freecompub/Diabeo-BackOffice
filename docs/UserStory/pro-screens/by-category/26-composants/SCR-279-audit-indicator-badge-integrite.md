# SCR-279 — Audit indicator (badge intégrité)

> 🔵 Priorité **V1** · 🧩 Type **COMPONENT** · Catégorie **26-Composants**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-279` |
| **Catégorie** | 26-Composants |
| **Nom** | Audit indicator (badge intégrité) |
| **Type** | COMPONENT |
| **Priorité** | **V1** |
| **Story points** | 2 |
| **Route Next.js** | `(component)` |

---

## 🎭 Personas concernés

Audit log, exports

---

## 🧭 Navigation

### Vient de (parents)
_Aucun_

### Mène vers (enfants / sorties)
_Aucun_

---

## 🎨 États possibles

- `verified`
- `warning`
- `failed`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Badge montrant l'intégrité cryptographique d'une donnée d'audit ou d'export

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
IntegrityBadge
```

### Route Next.js

```
(component)
```

### User Stories référencées

- US-2011


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
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
