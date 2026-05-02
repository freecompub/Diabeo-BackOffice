# SCR-135 — Tab — Données démographiques (édition)

> 🟢 Priorité **MVP** · 📑 Type **TAB** · Catégorie **05-FichePatient**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-135` |
| **Catégorie** | 05-FichePatient |
| **Nom** | Tab — Données démographiques (édition) |
| **Type** | TAB |
| **Priorité** | **MVP** |
| **Story points** | 5 |
| **Route Next.js** | `/patients/[id]/identity` |

---

## 🎭 Personas concernés

DOCTOR, ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Fiche patient

### Mène vers (enfants / sorties)
Modals confirmation

---

## 🎨 États possibles

- `view`
- `editing`
- `validation-error`
- `saved`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Toutes données identité, contact, couverture sociale, médecin traitant, pharmacie

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
PatientIdentityForm, ReadOnlyMode, EditMode
```

### Route Next.js

```
/patients/[id]/identity
```

### User Stories référencées

- US-2017


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
- Index par catégorie : [`05-fichepatient/README.md`](README.md)
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
