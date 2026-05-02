# SCR-204 — Messages programmés

> 🟡 Priorité **V2** · 📄 Type **PAGE** · Catégorie **15-Messagerie**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-204` |
| **Catégorie** | 15-Messagerie |
| **Nom** | Messages programmés |
| **Type** | PAGE |
| **Priorité** | **V2** |
| **Story points** | 8 |
| **Route Next.js** | `/messages/scheduled` |

---

## 🎭 Personas concernés

DOCTOR, NURSE

---

## 🧭 Navigation

### Vient de (parents)
Composer / Sidebar

### Mène vers (enfants / sorties)
Édition, Annulation

---

## 🎨 États possibles

- `empty`
- `with-scheduled`
- `sending`


> 💡 Chaque état doit avoir une UX définie : feedback visuel clair, message si applicable, comportement utilisateur attendu.

---

## 📐 Notes UX clés

Planification : rappel pré-consult, encouragement, vérification post-ajustement

---

## 🛠️ Implémentation technique

### Composants React à créer / utiliser

```
ScheduledMessages, ConditionEditor
```

### Route Next.js

```
/messages/scheduled
```

### User Stories référencées

- US-2262 Messages programmés


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
- Index par priorité : [`../by-priority/V2.md`](../by-priority/V2.md)
- Inventaire fonctionnel : `Diabeo_Inventaire_Fonctionnalites.xlsx`
- US backoffice : `Diabeo_UserStories_US2000.zip`
