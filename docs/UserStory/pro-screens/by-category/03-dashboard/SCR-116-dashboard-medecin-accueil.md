# SCR-116 — Dashboard médecin (accueil)

> 🟢 Priorité **MVP** · 📄 Type **PAGE** · Catégorie **03-Dashboard**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-116` |
| **Catégorie** | 03-Dashboard |
| **Nom** | Dashboard médecin (accueil) |
| **Type** | PAGE |
| **Priorité** | **MVP** |
| **Story points** | 8 |
| **Route Next.js** | `/dashboard` |

---

## 🎭 Personas concernés

DOCTOR, NURSE

---

## 🧭 Navigation

### Vient de (parents)
Login post-auth

### Mène vers (enfants / sorties)
Toutes sous-sections

---

## 🎨 États possibles

- `loading`
- `default`
- `empty (nouveau cabinet)`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Vue synthétique : urgences en cours, RDV du jour, patients à suivre, indicateurs cabinet

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
DashboardLayout, EmergencyInbox, TodayAppointments, PriorityPatientsList, KpiCards
```

### Route Next.js

```
/dashboard
```

### User Stories référencées

- US-2094 Tableau de bord population
- US-2224 Inbox urgences
- US-2230 Notif urgence


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
- Index par catégorie : [`03-dashboard/README.md`](README.md)
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
