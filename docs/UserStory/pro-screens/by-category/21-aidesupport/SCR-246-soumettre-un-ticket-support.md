# SCR-246 — Soumettre un ticket support

> 🔵 Priorité **V1** · 💬 Type **MODAL** · Catégorie **21-AideSupport**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-246` |
| **Catégorie** | 21-AideSupport |
| **Nom** | Soumettre un ticket support |
| **Type** | MODAL |
| **Priorité** | **V1** |
| **Story points** | 3 |
| **Route Next.js** | `(modal)` |

---

## 🎭 Personas concernés

Tous

---

## 🧭 Navigation

### Vient de (parents)
Centre d'aide

### Mène vers (enfants / sorties)
Confirmation

---

## 🎨 États possibles

- `default`
- `sending`
- `sent`
- `error`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Catégorie, description, captures d'écran, urgence

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
SupportTicketForm, FileUpload
```

### Route Next.js

```
(modal)
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
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
