# SCR-P-397 — 🍎 iOS — Procédure cétones sévères → SAMU

> 🟢 Priorité **MVP** · 📄 Type **PAGE** · Catégorie **27-Urgences-Cetones** · 📱🖥️ Toutes plateformes

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-P-397` |
| **Catégorie** | 27-Urgences-Cetones |
| **Nom** | Procédure cétones sévères → SAMU |
| **Type** | PAGE |
| **Priorité** | **MVP** |
| **Plateformes cibles** | 📱🖥️ Toutes plateformes |
| **Différences plateforme matérielles** | ✅ OUI — Téléphonie + GPS + SMS — 'tel:' link iOS, Intent.ACTION_CALL Android, web limité |
| **Story points (par plateforme)** | 13 |
| **Route** | `/emergency/ketones/severe` |

---

## 🎭 Personas concernés

Patients T1

---

## 🧭 Navigation

### Vient de (parents)
Notif cétones sévères

### Mène vers (enfants)
Appel SAMU

---

## 🎨 États possibles

- `warning`
- `calling-samu`
- `sharing-location`
- `ambulance-coming`


> 💡 Chaque état doit avoir une UX définie (feedback visuel, message, comportement).

---

## 📐 Notes UX clés

Alerte rouge plein écran, appel SAMU automatique, partage géoloc

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

- FNP-313


---

## 🛠️ Implémentation iOS

> Cet écran a un **fichier dédié iOS** parce que les différences matérielles avec les autres plateformes le justifient :
> **Téléphonie + GPS + SMS — 'tel:' link iOS, Intent.ACTION_CALL Android, web limité**

## 🍎 Spécificités iOS

### Stack technique
- **SDK minimum** : iOS 16.0
- **Langage** : Swift 5.9+
- **Frameworks** : `SwiftUI`, `Combine`, `UserNotifications`, `CoreLocation`
- **Architecture** : MVVM + Coordinator

### APIs et capacités spécifiques
- **Critical Alerts** : entitlement `com.apple.developer.usernotifications.critical-alerts`
- Téléphonie via `tel:` URL scheme ou CallKit

### Permissions à déclarer (Info.plist)
- `NSLocationWhenInUseUsageDescription`

### Comportement utilisateur iOS
- Navigation `NavigationStack` (iOS 16+)
- Haptic feedback `UIImpactFeedbackGenerator`
- Animations system-default (60 fps min, 120 fps si ProMotion)
- Support Dark Mode automatique

### Tests automatisés iOS
- Unitaires `XCTest` ≥ 80%
- UI `XCUITest` scénario nominal
- Accessibility Inspector + VoiceOver

### Distribution App Store
- Catégorie **Medical** (si applicable)
- Privacy Manifest (`PrivacyInfo.xcprivacy`) à jour
- TestFlight pour recette interne

### Composants
```
SevereKetonesFlow, SamuCallFlow
```


### 🔗 Voir aussi (autres plateformes)

- [`SCR-P-397-android`](./SCR-P-397-procedure-cetones-severes-samu-android.md) — version Android
- [`SCR-P-397-web`](./SCR-P-397-procedure-cetones-severes-samu-web.md) — version Web
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

### iOS-spécifique
- [ ] Tests sur 3 devices (iPhone SE, iPhone 15, iPad)
- [ ] Validation TestFlight ≥ 5 testeurs
- [ ] Privacy Manifest à jour
- [ ] Aucun warning Xcode

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
