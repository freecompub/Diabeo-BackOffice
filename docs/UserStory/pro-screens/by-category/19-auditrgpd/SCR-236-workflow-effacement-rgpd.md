# SCR-236 — Workflow effacement RGPD

> 🟢 Priorité **MVP** · 💬 Type **MODAL** · Catégorie **19-AuditRgpd**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-236` |
| **Catégorie** | 19-AuditRgpd |
| **Nom** | Workflow effacement RGPD |
| **Type** | MODAL |
| **Priorité** | **MVP** |
| **Story points** | 8 |
| **Route Next.js** | `(modal)` |

---

## 🎭 Personas concernés

ADMIN + patient consentement

---

## 🧭 Navigation

### Vient de (parents)
Demande RGPD ou Fiche patient

### Mène vers (enfants / sorties)
Confirmation lourde

---

## 🎨 États possibles

- `request`
- `validation`
- `processing`
- `completed`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Cascade soft delete + anonymisation + audit lourd + notif patient

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
GdprDeletionFlow, AuditTrail
```

### Route Next.js

```
(modal)
```

### User Stories référencées

- US-2135


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
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
