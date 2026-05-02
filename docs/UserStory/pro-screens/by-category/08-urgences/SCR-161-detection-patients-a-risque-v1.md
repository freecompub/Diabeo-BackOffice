# SCR-161 — Détection patients à risque (V1)

> 🔵 Priorité **V1** · 📄 Type **PAGE** · Catégorie **08-Urgences**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-161` |
| **Catégorie** | 08-Urgences |
| **Nom** | Détection patients à risque (V1) |
| **Type** | PAGE |
| **Priorité** | **V1** |
| **Story points** | 13 |
| **Route Next.js** | `/analytics/at-risk-patients` |

---

## 🎭 Personas concernés

DOCTOR

---

## 🧭 Navigation

### Vient de (parents)
Analytics, Dashboard

### Mène vers (enfants / sorties)
Fiche patient, Action

---

## 🎨 États possibles

- `loading`
- `with-list`
- `empty`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Liste patients identifiés : hypos répétées, DKA antérieurs, sous-déclaration, score de risque

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
AtRiskList, RiskScore, ActionSuggestion
```

### Route Next.js

```
/analytics/at-risk-patients
```

### User Stories référencées

- US-2229 Détection patterns


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
- Index par catégorie : [`08-urgences/README.md`](README.md)
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
