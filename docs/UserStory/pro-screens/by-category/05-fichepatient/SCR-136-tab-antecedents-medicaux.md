# SCR-136 — Tab — Antécédents médicaux

> 🟢 Priorité **MVP** · 📑 Type **TAB** · Catégorie **05-FichePatient**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-136` |
| **Catégorie** | 05-FichePatient |
| **Nom** | Tab — Antécédents médicaux |
| **Type** | TAB |
| **Priorité** | **MVP** |
| **Story points** | 5 |
| **Route Next.js** | `/patients/[id]/medical-history` |

---

## 🎭 Personas concernés

DOCTOR, NURSE

---

## 🧭 Navigation

### Vient de (parents)
Fiche patient

### Mène vers (enfants / sorties)
Ajout antécédent (modal)

---

## 🎨 États possibles

- `view`
- `editing`
- `with-data`
- `empty`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Personnels, familiaux, comorbidités CIM-10, allergies, vaccinations

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
MedicalHistorySection, ComorbiditiesList, AllergiesList
```

### Route Next.js

```
/patients/[id]/medical-history
```

### User Stories référencées

- US-2024 Comorbidités


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
