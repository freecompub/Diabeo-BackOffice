# SCR-P-427 — 🌐 Web — Date/Time picker

> 🟢 Priorité **MVP** · 🧩 Type **COMPONENT** · Catégorie **32-Composants** · 📱🖥️ Toutes plateformes

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-P-427` |
| **Catégorie** | 32-Composants |
| **Nom** | Date/Time picker |
| **Type** | COMPONENT |
| **Priorité** | **MVP** |
| **Plateformes cibles** | 📱🖥️ Toutes plateformes |
| **Différences plateforme matérielles** | ✅ OUI — Native pickers OS-spécifiques fondamentalement différents |
| **Story points (par plateforme)** | 3 |
| **Route** | `(component)` |

---

## 🎭 Personas concernés

Formulaires dates

---

## 🧭 Navigation

### Vient de (parents)
_Aucun_

### Mène vers (enfants)
_Aucun_

---

## 🎨 États possibles

- `default`
- `open`


> 💡 Chaque état doit avoir une UX définie (feedback visuel, message, comportement).

---

## 📐 Notes UX clés

Native iOS UIDatePicker / Android Material DatePicker / web custom

---

## 🔄 Modes contextuels applicables

Selon le profil patient, cette fonctionnalité doit adapter son comportement :

- 👶 **Mode pédiatrique** : multi-aidants, double notification parent, mode école si applicable
- 🤰 **Mode grossesse** : cibles strictes obstétriques, suivi SA si pertinent
- 🌙 **Mode Ramadan** : adaptation jeûne, conseils Sahur/Iftar
- ✈️ **Mode voyage** : adaptation fuseau horaire, contacts urgence locaux
- 🏃 **Mode sport** : vigilance hypo post-effort

> Voir l'US correspondante pour le détail des comportements par mode.

---

## 🔌 User Stories référencées

- _Aucune US directement référencée_


---

## 🛠️ Implémentation Web

> Cet écran a un **fichier dédié Web** parce que les différences matérielles avec les autres plateformes le justifient :
> **Native pickers OS-spécifiques fondamentalement différents**

## 🌐 Spécificités Web

### Stack technique
- **Framework** : Next.js 16 (App Router) + React 19 + TypeScript strict
- **UI** : Tailwind CSS + shadcn/ui
- **State** : Zustand ou TanStack Query
- **Auth** : JWT RS256 + WebAuthn

### Navigateurs supportés
- Desktop : Chrome, Firefox, Safari, Edge (2 dernières versions majeures)
- Mobile responsive : redirection app < 768px

### APIs web utilisées
- Conformité **WCAG 2.1 AA** + **RGAA 4.1**

### Capacités non disponibles ou dégradées
- Toutes les capacités principales disponibles en web

### Stratégies de fallback
- Aucun fallback nécessaire

### Tests automatisés Web
- Unitaires `Vitest` ≥ 85%
- E2E `Playwright` (Chromium + Firefox + WebKit)
- Performance `Lighthouse CI` (LCP < 2.5s, INP < 200ms)
- Accessibility `axe-core` 0 violation critique

### Distribution & contraintes
- Hébergement OVHcloud GRA (HDS-certifié)
- HTTPS obligatoire (TLS 1.3, HSTS)
- CSP stricte
- Conformité RGAA 4.1 auditée

### Composants
```
DatePicker, TimePicker
```


### 🔗 Voir aussi (autres plateformes)

- [`SCR-P-427-ios`](./SCR-P-427-date-time-picker-ios.md) — version iOS
- [`SCR-P-427-android`](./SCR-P-427-date-time-picker-android.md) — version Android
---

## ✅ Définition de Done

### Design (commun)
- [ ] Wireframe basse fidélité validé
- [ ] Maquette haute fidélité (Figma) validée par PO
- [ ] Tous les états listés sont designés
- [ ] Variantes responsive si applicable
- [ ] Conformité design system Diabeo (Sérénité Active)
- [ ] Accessibility review : contraste, taille texte, focus order
- [ ] Mode sombre testé si applicable

### Développement (commun)
- [ ] Composants implémentés (cf liste)
- [ ] Route fonctionnelle
- [ ] Tous les états gérés (loading, empty, error, success...)
- [ ] Tests E2E sur scénario nominal
- [ ] Tests d'accessibilité OK
- [ ] Internationalisation FR + AR (RTL) si UI

### Web-spécifique
- [ ] Lighthouse ≥ 90 (Perf, A11y, Best Practices, SEO)
- [ ] axe-core 0 violation critique
- [ ] Validation cross-browser (Chrome/Firefox/Safari/Edge)
- [ ] Aucun warning ESLint

### Sécurité & conformité (commun)
- [ ] AuditLog patient si action sensible
- [ ] Données chiffrées (cache local + transit)
- [ ] OWASP MASVS L2 (mobile) / ASVS L2 (web) vérifié
- [ ] Pas de secret en dur

### Validation
- [ ] Code review approuvée
- [ ] Validation produit / PO

---

## 🔗 Ressources

- Cartographie complète : [`README.md`](../README.md)
- Inventaire fonctionnel : `Diabeo_App_Patient_Inventaire.xlsx`
- US patient : `Diabeo_AppPatient_UserStories_US3000.zip`
