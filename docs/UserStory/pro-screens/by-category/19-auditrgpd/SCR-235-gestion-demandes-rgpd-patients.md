# SCR-235 — Gestion demandes RGPD patients

> 🔵 Priorité **V1** · 📄 Type **PAGE** · Catégorie **19-AuditRgpd**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-235` |
| **Catégorie** | 19-AuditRgpd |
| **Nom** | Gestion demandes RGPD patients |
| **Type** | PAGE |
| **Priorité** | **V1** |
| **Story points** | 8 |
| **Route Next.js** | `/admin/gdpr-requests` |

---

## 🎭 Personas concernés

ADMIN, DPO

---

## 🧭 Navigation

### Vient de (parents)
Sidebar Admin

### Mène vers (enfants / sorties)
Détail demande

---

## 🎨 États possibles

- `loading`
- `with-requests`
- `processing`
- `empty`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Liste demandes Art. 15 (export), Art. 17 (suppression), Art. 16 (rectif)

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
GdprRequestsList, RequestDetail
```

### Route Next.js

```
/admin/gdpr-requests
```

### User Stories référencées

- US-2134 Export Art.15
- US-2135 Effacement Art.17


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
- Index par catégorie : [`19-auditrgpd/README.md`](README.md)
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
