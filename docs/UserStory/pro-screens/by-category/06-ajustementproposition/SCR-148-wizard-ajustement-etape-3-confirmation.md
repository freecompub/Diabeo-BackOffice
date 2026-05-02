# SCR-148 — Wizard ajustement — Étape 3 Confirmation

> 🟢 Priorité **MVP** · 🧙 Type **WIZARD_STEP** · Catégorie **06-AjustementProposition**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-148` |
| **Catégorie** | 06-AjustementProposition |
| **Nom** | Wizard ajustement — Étape 3 Confirmation |
| **Type** | WIZARD_STEP |
| **Priorité** | **MVP** |
| **Story points** | 8 |
| **Route Next.js** | `/patients/[id]/proposals/new/confirm` |

---

## 🎭 Personas concernés

DOCTOR

---

## 🧭 Navigation

### Vient de (parents)
Étape 2

### Mène vers (enfants / sorties)
Liste propositions

---

## 🎨 États possibles

- `review`
- `signing`
- `submitted`
- `error`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Récap final, justification clinique obligatoire, audit log preview, bouton signer & envoyer au patient

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
ProposalSummary, RationaleField, AuditPreview, SignButton
```

### Route Next.js

```
/patients/[id]/proposals/new/confirm
```

### User Stories référencées

- US-2061


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
- Index par catégorie : [`06-ajustementproposition/README.md`](README.md)
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
