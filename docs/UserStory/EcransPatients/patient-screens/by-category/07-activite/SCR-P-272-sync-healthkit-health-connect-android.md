# SCR-P-272 — 🤖 Android — Sync HealthKit / Health Connect

> 🔵 Priorité **V1** · 📄 Type **PAGE** · Catégorie **07-Activite** · 📱 Mobile (iOS + Android)

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-P-272` |
| **Catégorie** | 07-Activite |
| **Nom** | Sync HealthKit / Health Connect |
| **Type** | PAGE |
| **Priorité** | **V1** |
| **Plateformes cibles** | 📱 Mobile (iOS + Android) |
| **Différences plateforme matérielles** | ✅ OUI — HealthKit (iOS) vs Health Connect (Android) vs N/A web |
| **Story points (par plateforme)** | 8 |
| **Route** | `/activity/health-sync` |

---

## 🎭 Personas concernés

Tous mobile

---

## 🧭 Navigation

### Vient de (parents)
Tab profil / Onboarding

### Mène vers (enfants)
`SCR-P-273` — Liste activités

---

## 🎨 États possibles

- `default`
- `requesting-permission`
- `syncing`
- `error`


> 💡 Chaque état doit avoir une UX définie (feedback visuel, message, comportement).

---

## 📐 Notes UX clés

Demande permission OS, choix des données à synchroniser

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

- FNP-094
- FNP-095


---

## 🛠️ Implémentation Android

> Cet écran a un **fichier dédié Android** parce que les différences matérielles avec les autres plateformes le justifient :
> **HealthKit (iOS) vs Health Connect (Android) vs N/A web**

## 🤖 Spécificités Android

### Stack technique
- **API minimum** : 26 (Android 8.0)
- **API target** : 34 (Android 14)
- **Langage** : Kotlin 1.9+
- **Dépendances** : `Jetpack Compose`, `Coroutines + Flow`, `Health Connect (Android 14+)`
- **Architecture** : MVVM + Hilt

### APIs et capacités spécifiques
- APIs Compose / AndroidX standard

### Permissions (AndroidManifest.xml)
- `health.READ_HEART_RATE`
- `health.READ_STEPS`

### Comportement utilisateur Android
- Navigation `NavHost` Compose
- Haptic `HapticFeedbackConstants.CONTEXT_CLICK`
- Material Motion (250ms / 350ms)
- Dynamic Color (Material You) + fallback Diabeo
- Dark Theme auto

### Tests automatisés Android
- Unitaires `JUnit 5` + `MockK` ≥ 80%
- UI `Compose UI Test`
- Firebase Test Lab multi-devices
- Accessibility Scanner

### Distribution Play Store
- Catégorie **Medical**
- Data Safety form à jour
- Health Apps Policy compliance
- Internal Testing track

### Composants
```
HealthSyncFlow
```


### 🔗 Voir aussi (autres plateformes)

- [`SCR-P-272-ios`](./SCR-P-272-sync-healthkit-health-connect-ios.md) — version iOS
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

### Android-spécifique
- [ ] Tests Firebase Test Lab ≥ 5 références
- [ ] Validation Internal Testing track
- [ ] Data Safety form à jour
- [ ] Aucun warning Lint

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
