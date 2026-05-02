# SCR-216 — Détail facture (lecture)

> 🔵 Priorité **V1** · 📄 Type **PAGE** · Catégorie **17-Facturation**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-216` |
| **Catégorie** | 17-Facturation |
| **Nom** | Détail facture (lecture) |
| **Type** | PAGE |
| **Priorité** | **V1** |
| **Story points** | 5 |
| **Route Next.js** | `/billing/invoices/[id]` |

---

## 🎭 Personas concernés

ADMIN, DOCTOR (sa pratique)

---

## 🧭 Navigation

### Vient de (parents)
[Liste factures](../17-facturation/SCR-215-liste-factures.md)

### Mène vers (enfants / sorties)
Téléchargement, Annulation

---

## 🎨 États possibles

- `draft`
- `issued`
- `paid`
- `refunded`
- `cancelled`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Vue PDF, statut, historique paiement, actions (relance, refund)

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
InvoiceDetail, PdfViewer, ActionPanel
```

### Route Next.js

```
/billing/invoices/[id]
```

### User Stories référencées

- US-2107


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
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
