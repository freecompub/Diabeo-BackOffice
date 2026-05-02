# SCR-144 — Tab — Communication & messages

> 🔵 Priorité **V1** · 📑 Type **TAB** · Catégorie **05-FichePatient**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-144` |
| **Catégorie** | 05-FichePatient |
| **Nom** | Tab — Communication & messages |
| **Type** | TAB |
| **Priorité** | **V1** |
| **Story points** | 5 |
| **Route Next.js** | `/patients/[id]/messages` |

---

## 🎭 Personas concernés

DOCTOR, NURSE, VIEWER

---

## 🧭 Navigation

### Vient de (parents)
Fiche patient

### Mène vers (enfants / sorties)
Composer message, Détail message

---

## 🎨 États possibles

- `empty`
- `with-thread`
- `typing`
- `sending`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Thread chronologique avec patient, indicateurs vu/lu, pièces jointes, templates

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
MessageThread, MessageComposer, AttachmentList
```

### Route Next.js

```
/patients/[id]/messages
```

### User Stories référencées

- US-2076 Messagerie sécurisée


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
- Index par priorité : [`../by-priority/V1.md`](../by-priority/V1.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
