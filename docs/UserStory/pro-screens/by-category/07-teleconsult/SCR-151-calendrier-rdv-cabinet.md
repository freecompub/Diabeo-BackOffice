# SCR-151 — Calendrier RDV cabinet

> 🔵 Priorité **V1** · 📄 Type **PAGE** · Catégorie **07-Teleconsult**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-151` |
| **Catégorie** | 07-Teleconsult |
| **Nom** | Calendrier RDV cabinet |
| **Type** | PAGE |
| **Priorité** | **V1** |
| **Story points** | 8 |
| **Route Next.js** | `/calendar` |

---

## 🎭 Personas concernés

DOCTOR, NURSE, ADMIN

---

## 🧭 Navigation

### Vient de (parents)
Sidebar

### Mène vers (enfants / sorties)
Détail RDV, [Création RDV](../07-teleconsult/SCR-152-creation-rdv.md)

---

## 🎨 États possibles

- `loading`
- `default`
- `with-rdv`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Vue jour/semaine/mois, tous médecins ou filtré, drag-drop pour reschedule

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
CalendarView, AppointmentBlock, ResourceFilter
```

### Route Next.js

```
/calendar
```

### User Stories référencées

- _Aucune US directement référencée pour cet écran_


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
- Index par catégorie : [`07-teleconsult/README.md`](README.md)
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
