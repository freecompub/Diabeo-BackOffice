# SCR-154 — Salle de visioconférence (V4)

> 🔴 Priorité **V4** · 📄 Type **PAGE** · Catégorie **07-Teleconsult**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-154` |
| **Catégorie** | 07-Teleconsult |
| **Nom** | Salle de visioconférence (V4) |
| **Type** | PAGE |
| **Priorité** | **V4** |
| **Story points** | 13 |
| **Route Next.js** | `/teleconsult/[id]/room` |

---

## 🎭 Personas concernés

DOCTOR, NURSE

---

## 🧭 Navigation

### Vient de (parents)
Détail RDV

### Mène vers (enfants / sorties)
Compte-rendu

---

## 🎨 États possibles

- `pre-call (test)`
- `in-call`
- `ended`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Vidéo + chat side panel + accès rapide données patient + bouton compte-rendu

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
VideoRoom, ChatPanel, PatientDataPanel
```

### Route Next.js

```
/teleconsult/[id]/room
```

### User Stories référencées

- US-2066 Visio (V4)


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
- Index par priorité : [`../by-priority/V4.md`](../by-priority/V4.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
