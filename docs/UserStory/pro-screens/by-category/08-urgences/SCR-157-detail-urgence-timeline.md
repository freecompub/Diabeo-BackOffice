# SCR-157 — Détail urgence — Timeline

> 🟢 Priorité **MVP** · 📄 Type **PAGE** · Catégorie **08-Urgences**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-157` |
| **Catégorie** | 08-Urgences |
| **Nom** | Détail urgence — Timeline |
| **Type** | PAGE |
| **Priorité** | **MVP** |
| **Story points** | 13 |
| **Route Next.js** | `/emergencies/[id]` |

---

## 🎭 Personas concernés

DOCTOR, NURSE

---

## 🧭 Navigation

### Vient de (parents)
Inbox urgences

### Mène vers (enfants / sorties)
Réaction médecin, Fiche patient

---

## 🎨 États possibles

- `loading`
- `in-progress`
- `resolved`
- `escalated`
- `with-samu`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Timeline minute par minute : déclenchement, étapes patient, glycémies, fin, contexte

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
EmergencyTimeline, ContextPanel, ActionButtons
```

### Route Next.js

```
/emergencies/[id]
```

### User Stories référencées

- US-2225 Détail timeline


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
- Index par priorité : [`../by-priority/MVP.md`](../by-priority/MVP.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
