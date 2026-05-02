# SCR-P-296 — 🍎 iOS — Salle visioconférence

> 🔴 Priorité **V4** · 📄 Type **PAGE** · Catégorie **10-Teleconsult** · 📱🖥️ Toutes plateformes

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `SCR-P-296` |
| **Catégorie** | 10-Teleconsult |
| **Nom** | Salle visioconférence |
| **Type** | PAGE |
| **Priorité** | **V4** |
| **Plateformes cibles** | 📱🖥️ Toutes plateformes |
| **Différences plateforme matérielles** | ✅ OUI — WebRTC + APIs natives plateforme + plein écran iOS PiP |
| **Story points (par plateforme)** | 13 |
| **Route** | `/appointments/[id]/room` |

---

## 🎭 Personas concernés

Tous

---

## 🧭 Navigation

### Vient de (parents)
Détail RDV / Pré-call

### Mène vers (enfants)
Compte-rendu

---

## 🎨 États possibles

- `connecting`
- `in-call`
- `screen-share`
- `ended`


> 💡 Chaque état doit avoir une UX définie (feedback visuel, message, comportement).

---

## 📐 Notes UX clés

Vidéo plein écran, contrôles, chat, partage glycémie temps réel

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

- FNP-127


---

## 🛠️ Implémentation iOS

> Cet écran a un **fichier dédié iOS** parce que les différences matérielles avec les autres plateformes le justifient :
> **WebRTC + APIs natives plateforme + plein écran iOS PiP**

## 🍎 Spécificités iOS

### Stack technique
- **SDK minimum** : iOS 16.0
- **Langage** : Swift 5.9+
- **Frameworks** : `SwiftUI`, `Combine`
- **Architecture** : MVVM + Coordinator

### APIs et capacités spécifiques
- APIs SwiftUI standard

### Permissions à déclarer (Info.plist)
- Aucune permission spécifique

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
VideoCallRoom, ChatPanel
```


### 🔗 Voir aussi (autres plateformes)

- [`SCR-P-296-android`](./SCR-P-296-salle-visioconference-android.md) — version Android
- [`SCR-P-296-web`](./SCR-P-296-salle-visioconference-web.md) — version Web
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
