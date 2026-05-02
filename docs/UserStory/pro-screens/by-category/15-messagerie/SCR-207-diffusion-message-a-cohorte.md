# SCR-207 — Diffusion message à cohorte

> 🟠 Priorité **V3** · 📄 Type **PAGE** · Catégorie **15-Messagerie**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-207` |
| **Catégorie** | 15-Messagerie |
| **Nom** | Diffusion message à cohorte |
| **Type** | PAGE |
| **Priorité** | **V3** |
| **Story points** | 13 |
| **Route Next.js** | `/messages/broadcast` |

---

## 🎭 Personas concernés

DOCTOR, ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Messagerie / Analytics

### Mène vers (enfants / sorties)
Validation, Envoi

---

## 🎨 États possibles

- `draft`
- `validating-consents`
- `ready`
- `sent`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Envoi groupé (ex: tous T1 du cabinet, tous en mode Ramadan). Validation médicale + consentement.

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
BroadcastBuilder, CohortPicker, ConsentValidator
```

### Route Next.js

```
/messages/broadcast
```

### User Stories référencées

- US-2265 Diffusion cohorte


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
- Index par catégorie : [`15-messagerie/README.md`](README.md)
- Index par priorité : [`../by-priority/V3.md`](../by-priority/V3.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
