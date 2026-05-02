# US-3023 — Pro Santé Connect Patient / MES login

> 📌 **2. Auth & sécurité app** · Priorité **V2** · Plateforme **📱🖥️**

> 💬 **Note inventaire** : DZ: pas d'équivalent national

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-3023` |
| **Référence inventaire** | `FNP-023` |
| **Domaine** | 2. Auth & sécurité app |
| **Priorité** | **V2** |
| **Plateforme cible** | 📱🖥️ |
| **Intégration externe** | Oui |
| **Service / Standard** | ANS — France Connect / Mon Espace Santé |
| **Modèle économique** | Gratuit + homologation |
| **Coût estimé** | Audit ~5-15 k€ |
| **Faisabilité France** | Direct |
| **Faisabilité Algérie** | Non disponible |
| **Story points (3 plateformes)** | iOS 3 · Android 3 · Web 2 |
| **Statut** | 🆕 À démarrer |
| **Dépendances** | US-3001 (Inscription / login) |
| **Sprint cible** | À définir |

---

## 📋 Contexte métier

### Pourquoi cette fonctionnalité ?

SSO patient France

Cette fonctionnalité s'inscrit dans le domaine **2. Auth & sécurité app** de l'application patient Diabeo, plateforme de gestion personnelle du diabète insulino-traité. Elle est utilisée par les patients (et leurs aidants pour la pédiatrie / dépendance) au quotidien dans leur parcours de soins, et complète le travail de l'équipe soignante côté backoffice.

### Persona principal

Un patient adulte ou adolescent atteint de diabète (Type 1, Type 2 sous insuline, gestationnel ou MODY), suivi par un cabinet de diabétologie utilisant Diabeo BackOffice, équipé d'un smartphone (iOS ou Android) et/ou d'un ordinateur (Web), avec un dispositif CGM le plus souvent (FreeStyle Libre ou Dexcom).

### Valeur produit

- **Pour le patient** : autonomie, sécurité, gain de temps, meilleur équilibre glycémique
- **Pour l'équipe soignante** : meilleures données pour ajustement, prévention des urgences
- **Pour le système de santé** : réduction des hospitalisations (hypos sévères, DKA)

### Faisabilité par pays

⚠️ **Faisabilité limitée Algérie** : cette fonctionnalité dépend d'un service ou écosystème non disponible en DZ. Périmètre réduit ou comportement dégradé à prévoir.

---

## 📱 Spécificités iOS

### Stack technique
- **SDK minimum** : iOS 16.0 (raison : Lock Screen widgets, Live Activities, App Intents)
- **Langage** : Swift 5.9+
- **Frameworks** : `SwiftUI`, `Combine`
- **Architecture** : MVVM + Coordinator, dépendances injectées via Swinject ou similaire

### APIs et capacités spécifiques
- APIs UIKit/SwiftUI standard

### Permissions à déclarer (`Info.plist`)
- Aucune permission spécifique au-delà des permissions standards de l'app

### Comportement utilisateur
La fonctionnalité « Pro Santé Connect Patient / MES login » est exposée selon les conventions iOS :
- Navigation via `NavigationStack` (iOS 16+) ou pile UIKit pour compatibilité
- Haptic feedback via `UIImpactFeedbackGenerator` aux actions importantes
- Animations system-default (60 fps minimum, 120 fps si ProMotion)
- Support **Dark Mode** automatique via `Color.primary` / `.systemBackground`

### Tests automatisés iOS
- **Unitaires** : `XCTest` — couverture cible ≥ 80% sur la logique métier
- **UI** : `XCUITest` — au moins un scénario nominal end-to-end
- **Snapshot** : `swift-snapshot-testing` pour les vues complexes
- **Accessibility** : Accessibility Inspector + scripts XCUITest avec `accessibilityElements`

### Distribution & contraintes App Store
- Catégorie **Medical** dans App Store Connect (si applicable au flow)
- Mention **Dispositif Médical CE classe IIa** si la fonctionnalité touche au calcul de dose
- Pré-recette via **TestFlight** (interne ≤ 100, externe ≤ 10 000)
- Privacy Manifest (`PrivacyInfo.xcprivacy`) — déclaration des données collectées requise depuis 2024

### Effort estimé
**3 story points** (Fibonacci) sur la plateforme iOS

---

## 🤖 Spécificités Android

### Stack technique
- **API minimum** : 26 (Android 8.0) pour BLE stable
- **API target** : 34 (Android 14) — exigence Play Store 2024
- **Langage** : Kotlin 1.9+
- **Dépendances** : `Jetpack Compose`, `Coroutines + Flow`
- **Architecture** : MVVM + Hilt (DI) + Repository pattern

### APIs et capacités spécifiques
- APIs Compose / AndroidX standard

### Permissions à déclarer (`AndroidManifest.xml`)
- Aucune permission spécifique au-delà des permissions standards

### Comportement utilisateur
La fonctionnalité « Pro Santé Connect Patient / MES login » suit les Material Design 3 guidelines :
- Navigation via `NavHost` Compose
- Haptic feedback via `HapticFeedbackConstants.CONTEXT_CLICK`
- Animations Material Motion (durations standard 250ms / 350ms)
- Support **Dynamic Color** (Material You, Android 12+) avec fallback palette Diabeo
- Support automatique du **Dark Theme**

### Tests automatisés Android
- **Unitaires** : `JUnit 5` + `MockK` — couverture cible ≥ 80%
- **UI** : `Compose UI Test` (`composeRule.onNodeWithText(...)`)
- **Instrumented** : `AndroidJUnitRunner` pour tests sur émulateur/device
- **Firebase Test Lab** : recette multi-devices (au moins 5 références)
- **Accessibility Scanner** Google + `accessibility-test-framework`

### Distribution & contraintes Google Play
- Catégorie **Medical** dans Play Console
- **Data Safety form** : déclaration explicite collecte données de santé
- **Health Apps Policy** : conformité requise pour apps médicales
- Recette interne via **Internal Testing track**
- Si fonctionnalité = Dispositif Médical : marquage CE + déclaration

### Effort estimé
**3 story points** (Fibonacci) sur la plateforme Android

---

## 🌐 Spécificités Web

### Stack technique
- **Framework** : Next.js 16 (App Router) + React 19 + TypeScript strict
- **UI** : Tailwind CSS + shadcn/ui (cohérence avec backoffice pro)
- **State** : Zustand ou TanStack Query selon contexte
- **Auth** : JWT RS256 (cohérent backend) + WebAuthn pour biométrie

### Navigateurs supportés
- **Desktop** : Chrome, Firefox, Safari, Edge (2 dernières versions majeures)
- **Mobile (responsive)** : Safari iOS 16+, Chrome Android — mais redirection vers app mobile recommandée si < 768px

### APIs web utilisées
- Conformité **WCAG 2.1 AA** + **RGAA 4.1** (obligation légale FR pour services en santé)

### Capacités non disponibles en web ou dégradées
- Toutes les capacités principales de la fonctionnalité sont disponibles en web

### Stratégies de fallback
- Aucun fallback nécessaire — fonctionnalité native web

### Comportement utilisateur
La version web de « Pro Santé Connect Patient / MES login » est optimisée pour :
- Écran ≥ 1024px (desktop / tablette paysage)
- Layout responsive ≥ 768px avec adaptation mobile
- En dessous de 768px : suggestion d'ouverture de l'app mobile via deeplink store

### Tests automatisés Web
- **Unitaires** : `Vitest` — couverture cible ≥ 85%
- **E2E** : `Playwright` sur Chromium + Firefox + WebKit (équivalent Safari)
- **Performance** : `Lighthouse CI` — LCP < 2.5s, INP < 200ms, CLS < 0.1
- **Accessibility** : `axe-core` automatisé en CI + audit manuel
- **Visual regression** : `Percy` ou `Chromatic` (optionnel)

### Distribution & contraintes
- Hébergement OVHcloud GRA (HDS-certifié) — cohérent backoffice
- HTTPS obligatoire (TLS 1.3, HSTS, certificate pinning impossible mais Expect-CT)
- CSP stricte, X-Frame-Options DENY, X-Content-Type-Options nosniff
- Conformité **RGAA 4.1** auditée (obligation FR services publics santé)
- PWA optionnelle (manifest + Service Worker pour mode dégradé hors-ligne)

### Effort estimé
**2 story points** (Fibonacci) sur la plateforme Web

---



---

## ✅ Critères d'acceptation

### AC-1 — Accès autorisé respecté

```gherkin
Étant donné Un patient authentifié sur l'app
Quand il accède à la fonctionnalité « Pro Santé Connect Patient / MES login »
Alors l'action est autorisée et l'AuditLog patient enregistre l'accès
```

### AC-2 — Comportement multiplate-formes cohérent

```gherkin
Étant donné Le patient utilise la même fonctionnalité sur 2 appareils différents (ex: iPhone + Web)
Quand il effectue une action sur l'un puis consulte l'autre
Alors les données sont synchronisées en moins de 5 secondes (online) ou à reconnexion (offline)
```

### AC-3 — Tolérance panne service externe

```gherkin
Étant donné Le service « ANS — France Connect / Mon Espace Santé » est indisponible
Quand le patient utilise la fonctionnalité
Alors un message clair est affiché, les données ne sont pas perdues, retry automatique configuré
```


---

## 📐 Règles métier

- **RM-1 : Toute action sur cette fonctionnalité est journalisée dans AuditLog patient (action, resource, resourceId, ipAddress, deviceInfo).**
- **RM-2 : Le patient ne peut accéder qu'à ses propres données (vérification systématique du `patientId` du token JWT vs ressource).**
- **RM-3 : Tous les inputs sont validés par schéma Zod (web/Next.js) ou équivalent type-safe (Swift/Kotlin).**
- **RM-6 : Aucun secret du fournisseur « ANS — France Connect / Mon Espace Santé » n'est embarqué dans les binaires mobiles ni exposé côté client web. Tous les appels passent par le backend Diabeo.**

---

## 🗄️ Modèle de données

### Cohérence avec le backoffice
Cette fonctionnalité **réutilise les modèles Prisma** définis côté backoffice Diabeo (48 tables existantes). Voir `docs/architecture/data-model.md`. Aucun nouveau modèle n'est créé côté patient — l'app patient est cliente du même backend.

### Cache local mobile
Les données nécessaires au fonctionnement hors-ligne sont mises en cache localement :
- **iOS** : CoreData encrypted store (clé dérivée du keychain)
- **Android** : Room + SQLCipher (clé dérivée du Android Keystore)
- **Web** : IndexedDB chiffré via Web Crypto API

Le schéma local est aligné sur le schéma serveur, avec en plus :
- Une table `SyncQueue` (opérations en attente de push)
- Une table `LastSyncCursor` (dernier point de sync par ressource)

---

## 🔌 API & contrats

### Endpoint principal côté backend Diabeo
La fonctionnalité consomme l'API REST du backoffice. Endpoint typique :
```
GET  /api/patient/2/...
POST /api/patient/2/...
```

### Authentification
- JWT RS256 avec scope `patient:*`
- Header `Authorization: Bearer <token>`
- Refresh automatique côté client si 401

### Format payload
- Content-Type : `application/json`
- Validation : Zod côté serveur, types TypeScript / Swift / Kotlin partagés via génération à partir d'OpenAPI

---

## ⚠️ Scénarios d'erreur

| HTTP | Code applicatif | Message patient (UX-friendly) | Comportement |
|------|-----------------|-------------------------------|--------------|
| 400 | `VALIDATION_ERROR` | « Une information saisie est incorrecte » | Afficher quel champ + explication |
| 401 | `UNAUTHENTICATED` | « Veuillez vous reconnecter » | Refresh token, sinon login |
| 403 | `FORBIDDEN` | « Action non autorisée » | Message générique |
| 404 | `NOT_FOUND` | « Information introuvable » | Sans détail révélateur |
| 409 | `CONFLICT` | « Modification déjà effectuée ailleurs » | Resync auto |
| 422 | `BUSINESS_RULE_VIOLATED` | Message contextuel | Détail métier |
| 429 | `RATE_LIMITED` | « Trop de requêtes, réessayez bientôt » | Retry-After |
| 500 | `INTERNAL_ERROR` | « Une erreur est survenue, l'équipe a été notifiée » | Sentry + ID |
| 503 | `SERVICE_UNAVAILABLE` | « Service temporairement indisponible » | Retry auto |

### Scénario hors-ligne
En l'absence de réseau, la fonctionnalité **fonctionne en mode dégradé** sur les capacités vitales (consultation, saisie urgences, calculs). Une bannière non-bloquante indique l'état "Hors ligne — synchronisation en attente".

---

## 🔒 Sécurité & conformité HDS

### Authentification utilisateur
- Login email/mdp + biométrie sur mobile (Face ID / Touch ID / BiometricPrompt)
- WebAuthn sur web pour biométrie cross-platform
- Code PIN local 6 chiffres en fallback

### Stockage local sécurisé
- iOS : encrypted CoreData + Keychain pour clé maître
- Android : Room + SQLCipher + Android Keystore
- Web : IndexedDB + Web Crypto API (chiffrement AES-GCM)

### Transmission
- TLS 1.3 obligatoire (refus TLS < 1.2)
- Certificate pinning sur mobile (URLSession `serverTrust` / OkHttp `CertificatePinner`)
- HSTS strict côté web

### Audit log patient
Chaque action sensible déclenche un appel `auditService.log(...)` côté backend. Le client mobile ajoute un champ `deviceInfo` (modèle, OS version, app version) pour traçabilité.

### RGPD côté patient
- Export RGPD Art. 15 disponible depuis l'app (US-3265)
- Effacement Art. 17 disponible depuis l'app (US-3266)
- Consentements granulaires (US-3263)

---

## 🧪 Plan de test 3 niveaux × 3 plateformes

### Tests unitaires
- **iOS** : XCTest sur la logique métier, mocks via protocoles
- **Android** : JUnit 5 + MockK
- **Web** : Vitest + Testing Library
- **Couverture cible** : ≥ 80% sur les services métier des 3 plateformes

### Tests d'intégration
- **iOS** : XCTest avec instances réelles de CoreData / réseau mocké
- **Android** : tests instrumentés avec Room en mémoire
- **Web** : Vitest + msw (Mock Service Worker) pour API mockées
- **Backend** : tests d'intégration côté backoffice (cf US-2xxx correspondante)

### Tests E2E
- **iOS** : XCUITest sur scénarios nominaux + edge cases
- **Android** : Espresso + UI Automator
- **Web** : Playwright (Chromium + Firefox + WebKit)
- **Cross-device** : test manuel de cohérence iPhone ↔ Web ↔ Android

### Tests de sécurité
- **OWASP MASVS** (Mobile) — Niveau L2 minimum (apps santé)
- **OWASP ASVS** (Web) — Niveau 2 minimum
- Tests d'injection, XSS, CSRF (web)
- Tests de jailbreak/root detection (mobile)
- Tests de leak data dans logs / crash reports

### Tests de conformité réglementaire
- AuditLog correctement enregistré pour chaque action
- Données chiffrées en local et en transit (vérifié par capture mémoire et trafic)
- Export RGPD inclut bien les données de cette fonctionnalité
- Effacement RGPD supprime / anonymise correctement
- Si Dispositif Médical (calcul dose) : conformité ISO 14971 (gestion risque) + IEC 62304 (cycle vie logiciel)

### Tests d'accessibilité
- iOS : VoiceOver complet, Dynamic Type jusqu'à xxxLarge
- Android : TalkBack complet, scaling 200%
- Web : axe-core green + audit manuel RGAA 4.1

---

## 📦 Définition de Done (par plateforme)

### Code & qualité (commun)
- [ ] Code review approuvée (2 reviewers dont 1 senior plateforme)
- [ ] Tests unitaires verts ≥ 80% couverture
- [ ] Tests d'intégration verts
- [ ] Tests E2E verts sur la plateforme concernée
- [ ] Aucun warning compilateur / lint
- [ ] CHANGELOG.md mis à jour

### iOS-spécifique
- [ ] Tests sur 3 devices (iPhone SE, iPhone 15, iPad)
- [ ] Validation TestFlight interne (≥ 5 testeurs)
- [ ] Privacy Manifest à jour
- [ ] Screenshots App Store si UI nouvelle
- [ ] Pas de warning Xcode

### Android-spécifique
- [ ] Tests sur Firebase Test Lab ≥ 5 références
- [ ] Validation Internal Testing track
- [ ] Data Safety form à jour
- [ ] Pas de warning Lint Android

### Web-spécifique
- [ ] Lighthouse score ≥ 90 sur Performance, Accessibility, Best Practices, SEO
- [ ] axe-core 0 violation critique
- [ ] Validation cross-browser (Chrome, Firefox, Safari, Edge)
- [ ] Pas de warning ESLint

### Sécurité & conformité (commun)
- [ ] AuditLog implémenté
- [ ] Données chiffrées (local + transit) vérifiées
- [ ] OWASP MASVS L2 (mobile) / ASVS L2 (web) vérifié
- [ ] Pas de secret en dur (gitleaks vert)
- [ ] Validation healthcare-security-auditor

### UX & accessibilité (commun)
- [ ] WCAG 2.1 AA / RGAA 4.1 conforme
- [ ] Support FR + AR (RTL) testé
- [ ] Loading / error / empty states définis
- [ ] Validation produit / PO

---

## 📚 Ressources

- Documentation interne projet : `docs/architecture/`
- Référentiel HDS ANS : https://esante.gouv.fr/produits-services/hds
- OWASP MASVS : https://mas.owasp.org/MASVS/
- Apple HIG (Health & Fitness) : https://developer.apple.com/design/human-interface-guidelines/
- Material Design 3 : https://m3.material.io/
- WCAG 2.1 AA : https://www.w3.org/WAI/WCAG21/quickref/
- RGAA 4.1 : https://accessibilite.numerique.gouv.fr/
- Documentation officielle **ANS — France Connect / Mon Espace Santé** (à valider en kick-off)

---

## 🔗 US liées

- Référence inventaire : `FNP-023`
- Inventaire complet : `Diabeo_App_Patient_Inventaire.xlsx`
- US miroir backoffice (à venir) : domaine `23-patient-management/`

*Auto-généré depuis l'inventaire fonctionnel — affiner manuellement les sections selon la conception détaillée du sprint.*
