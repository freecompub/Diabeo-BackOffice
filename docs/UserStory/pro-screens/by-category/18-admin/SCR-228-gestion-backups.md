# SCR-228 — Gestion backups

> 🟢 Priorité **MVP** · 📄 Type **PAGE** · Catégorie **18-Admin**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-228` |
| **Catégorie** | 18-Admin |
| **Nom** | Gestion backups |
| **Type** | PAGE |
| **Priorité** | **MVP** |
| **Story points** | 5 |
| **Route Next.js** | `/admin/backups` |

---

## 🎭 Personas concernés

ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Sidebar Admin

### Mène vers (enfants / sorties)
Restauration test

---

## 🎨 États possibles

- `loading`
- `with-history`
- `in-progress`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Liste backups, fréquence, succès/échecs, restore test (sandbox)

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
BackupsList, RestoreSandbox
```

### Route Next.js

```
/admin/backups
```

### User Stories référencées

- US-2151 Gestion backups


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
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
