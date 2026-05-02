# SCR-218 — Configuration paiement Stripe (V4)

> 🔴 Priorité **V4** · 📄 Type **PAGE** · Catégorie **17-Facturation**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-218` |
| **Catégorie** | 17-Facturation |
| **Nom** | Configuration paiement Stripe (V4) |
| **Type** | PAGE |
| **Priorité** | **V4** |
| **Story points** | 8 |
| **Route Next.js** | `/admin/billing/stripe` |

---

## 🎭 Personas concernés

ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Sidebar Admin (params)

### Mène vers (enfants / sorties)
Webhooks log

---

## 🎨 États possibles

- `default`
- `configuring`
- `connected`
- `error`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Connection Stripe, webhooks idempotents, refunds, dispute mgmt

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
StripeConfig, WebhooksLog
```

### Route Next.js

```
/admin/billing/stripe
```

### User Stories référencées

- US-2101 Stripe (V4)


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
- Index par catégorie : [`17-facturation/README.md`](README.md)
- Index par priorité : [`../by-priority/V4.md`](../by-priority/V4.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
