# Schéma de base de données — Diabeo BackOffice

Version: Phase 0  
Date de mise à jour: 2026-04-01  
Base de données: PostgreSQL 16  
ORM: Prisma 5+

---

## Table des matières

1. [Aperçu global](#aperçu-global)
2. [Enums](#enums)
3. [Domaine 1 — Utilisateur & Authentification](#domaine-1--utilisateur--authentification)
4. [Domaine 2 — Patient & Données Médicales](#domaine-2--patient--données-médicales)
5. [Domaine 3 — Configuration Insulinothérapie](#domaine-3--configuration-insulinothérapie)
6. [Domaine 4 — Données de Glycémie & CGM](#domaine-4--données-de-glycémie--cgm)
7. [Domaine 5 — Événements & Activités](#domaine-5--événements--activités)
8. [Domaine 6 — Propositions d'Ajustement](#domaine-6--propositions-dajustement)
9. [Domaine 7 — Appareils & Synchronisation](#domaine-7--appareils--synchronisation)
10. [Domaine 8 — Équipe Médicale](#domaine-8--équipe-médicale)
11. [Domaine 9 — Documents & Rendez-vous](#domaine-9--documents--rendez-vous)
12. [Domaine 10 — Notifications Push](#domaine-10--notifications-push)
13. [Domaine 11 — Configuration & UI](#domaine-11--configuration--ui)
14. [Audit Log (Immuable HDS)](#audit-log-immuable-hds)

---

## Aperçu global

Le schéma Diabeo contient **50 tables** réparties en **11 domaines métier**, avec **21 énums** pour les énumérations métier.

### Principles architecturaux

- **Chiffrement applicatif** : Données sensibles (email, NIR, antécédents) chiffrées AES-256-GCM avant insertion
- **Immuabilité audit** : AuditLog immuable par trigger PostgreSQL
- **Soft delete RGPD** : Les patients ne sont jamais supprimés physiquement, juste marqués avec `deletedAt`
- **HMAC pour lookups** : `emailHmac` (HMAC-SHA256) permet des indexes UNIQUE sans exposer l'email chiffré
- **Partitioning CGM** : Table `CgmEntry` partitionnée par mois pour gérer ~105k entries/patient/an
- **Transactions Prisma** : Calculs critiques (bolus) atomiques avec vérification de cohérence

### Distribution par domaine

| # | Domaine | Tables | Rôle |
|---|---------|--------|------|
| 1 | Utilisateur & Authentification | 7 | User, Account, Session, VerificationToken, UserUnitPreferences, UserNotifPreferences, UserPrivacySettings |
| 2 | Patient & Données Médicales | 4 | Patient, PatientMedicalData, PatientAdministrative, PatientPregnancy |
| 3 | Configuration Insulinothérapie | 10 | InsulinCatalog, PatientInsulin, InsulinTherapySettings, GlucoseTarget, IobSettings, ExtendedBolusSettings, InsulinSensitivityFactor, CarbRatio, BasalConfiguration, PumpBasalSlot |
| 4 | Données de Glycémie & CGM | 7 | CgmEntry, GlycemiaEntry, DiabetesEvent, InsulinFlowEntry, InsulinFlowDeviceData, PumpEvent, AverageData |
| 5 | Événements & Activités | 0 | Couvert par DiabetesEvent (domaine 4) |
| 6 | Propositions d'Ajustement | 1 | AdjustmentProposal |
| 7 | Appareils & Synchronisation | 2 | PatientDevice, DeviceDataSync |
| 8 | Équipe Médicale | 4 | HealthcareService, HealthcareMember, PatientService, PatientReferent |
| 9 | Documents & Rendez-vous | 3 | MedicalDocument, Appointment, Announcement |
| 10 | Notifications Push | 4 | PushDeviceRegistration, PushNotificationTemplate, PushNotificationLog, PushScheduledNotification |
| 11 | Configuration & UI | 5 | DashboardConfiguration, DashboardWidget, UnitDefinition, UserDayMoment, UiStateSave, BasalFlowSchedule |
| Spécial | Audit (HDS) | 1 | AuditLog |
| | **TOTAL** | **48** | |

---

## Enums

Les énumérations sont utilisées pour garantir la validité des données métier et faciliter les requêtes.

### Role
Usage: Contrôle d'accès (RBAC) pour tous les utilisateurs du backoffice.

| Valeur | Signification | Permissions |
|--------|---------------|-------------|
| ADMIN | Administrateur système | Gestion complète (users, audit, config) |
| DOCTOR | Médecin | Patients de son portefeuille, validation configs insuline |
| NURSE | Infirmier(ère) | Consultation patients, création configs (non-validées) |
| VIEWER | Lecteur seul | Accès en lecture sur périmètre autorisé |

**Stored in**: `User.role`

---

### Pathology
Usage: Type de diabète pour chaque patient.

| Valeur | Signification | Notes |
|--------|---------------|-------|
| DT1 | Diabète Type 1 | Auto-immune, dépendant de l'insuline dès le diagnostic |
| DT2 | Diabète Type 2 | Métabolique, évolution progressive |
| GD | Diabète Gestationnel | Pendant la grossesse, risque élevé de chronisation |

**Stored in**: `Patient.pathology`

---

### Sex
Usage: Genre biologique/identité.

| Valeur | Signification |
|--------|---------------|
| M | Masculin |
| F | Féminin |
| X | Autre/Non binaire |

**Stored in**: `User.sex`

---

### Language
Usage: Langue préférée pour l'interface et les notifications.

| Valeur | Signification |
|--------|---------------|
| fr | Français |
| en | Anglais |
| ar | Arabe |

**Stored in**: `User.language`, `PushNotificationTemplate` (titleFr, bodyFr, etc.)

---

### DayMomentType
Usage: Moments du jour pour personnaliser les rappels et les objectifs glycémiques.

| Valeur | Signification | Exemple d'horaire |
|--------|---------------|-------------------|
| morning | Matin | 06:00 - 12:00 |
| noon | Midi/Déjeuner | 12:00 - 14:00 |
| evening | Soir/Dîner | 18:00 - 21:00 |
| night | Nuit | 21:00 - 06:00 |
| custom | Personnalisé | Défini par l'utilisateur |

**Stored in**: `UserDayMoment.type`

---

### InsulinDeliveryMethod
Usage: Mode d'administration de l'insuline (affecte la formule de calcul bolus).

| Valeur | Signification | Impact |
|--------|---------------|--------|
| pump | Pompe à insuline | Bolus rapide immédiat, extended bolus possible |
| manual | Injection manuelle | Bolus simple, pas d'extended bolus |

**Stored in**: `InsulinTherapySettings.deliveryMethod`, `BolusCalculationLog.deliveryMethod`

### InsulinUsage
Usage: Rôle d'une insuline dans le traitement d'un patient.

| Valeur | Signification | Exemple |
|--------|---------------|---------|
| bolus | Insuline pour bolus repas/correction | Humalog, NovoRapid, Fiasp |
| basal | Insuline basale (couverture continue) | Lantus, Levemir, Tresiba |
| both | Les deux (pré-mélangées) | NovoMix 30, Humalog Mix 25 |

**Stored in**: `PatientInsulin.usage`

---

### TreatmentType
Usage: Type de traitement utilisé par le patient (peut être multiple).

| Valeur | Signification | Exemple |
|--------|---------------|---------|
| fgm | Lecteur continu (FGM) | FreeStyle Libre, Dexcom, Guardian |
| pump | Pompe à insuline | Medtronic, Tandem, Omnipod |
| insulin_pump | Variante pompe | Distinction peut-être obsolète |
| glp1 | Agoniste GLP-1 | Ozempic, Saxenda, Mounjaro |

**Stored in**: `Treatment.type`

---

### BasalConfigType
Usage: Mode de configuration de l'insuline basale.

| Valeur | Signification | Configuration |
|--------|---------------|----------------|
| pump | Pompe à insuline | Profil basal horaire (24 slots) |
| single_injection | Injection unique | Dose unique quotidienne (ex: NPH le soir) |
| split_injection | Injections fractionnées | Matin + soir (ex: NPH matin + soir) |

**Stored in**: `BasalConfiguration.configType`

---

### GlucoseTargetPreset
Usage: Présets cliniques pour les objectifs glycémiques.

| Valeur | Signification | Cible (mg/dL) | Cas d'usage |
|--------|---------------|---------------|-----------|
| standard | Standard adulte | 120-180 | Diabète type 1/2 adulte |
| tight | Strict | 80-130 | Excellent contrôle souhaité |
| pediatric | Pédiatrique | 90-150 | Enfants (risque hypoglycémie) |
| elderly | Personnes âgées | 130-180 | Fragilité, risque chutes |
| custom | Personnalisé | Variable | Défini par le médecin |

**Stored in**: `GlucoseTarget.preset`

---

### AdjustableParameter
Usage: Type de paramètre que l'IA peut proposer d'ajuster.

| Valeur | Signification | Formule impactée |
|--------|---------------|------------------|
| basalRate | Taux basal | `basalDose` en U/h |
| insulinSensitivityFactor | Facteur de sensibilité | `correctionDose = (currentGlucose - target) / ISF` |
| insulinToCarbRatio | Ratio insuline-glucides | `mealBolus = carbs / ICR` |

**Stored in**: `AdjustmentProposal.parameterType`

---

### AdjustmentReason
Usage: Raison de la proposition d'ajustement (pour traçabilité médical).

| Valeur | Signification | Contexte |
|--------|---------------|----------|
| basalTooLow | Basal insuffisant | Glycémies élevées entre repas |
| basalTooHigh | Basal excessif | Glycémies basses entre repas |
| basalCorrect | Basal correct | Pas de changement conseillé |
| isfTooLow | ISF insuffisant | Corrections insuffisantes |
| isfTooHigh | ISF excessif | Corrections trop fortes |
| isfCorrect | ISF correct | Pas de changement conseillé |
| icrTooLow | ICR insuffisant | Glycémies élevées post-repas |
| icrTooHigh | ICR excessif | Glycémies basses post-repas |
| icrCorrect | ICR correct | Pas de changement conseillé |
| insufficientData | Données insuffisantes | Analyse impossible (< N événements) |

**Stored in**: `AdjustmentProposal.reason`

---

### ConfidenceLevel
Usage: Niveau de confiance de la proposition d'ajustement.

| Valeur | Signification | Seuil de données |
|--------|---------------|------------------|
| low | Faible | < 10 événements pertinents |
| medium | Moyen | 10-30 événements |
| high | Élevé | > 30 événements |

**Stored in**: `AdjustmentProposal.confidence`

---

### ProposalStatus
Usage: État de cycle de vie d'une proposition d'ajustement.

| Valeur | Signification | Action requise |
|--------|---------------|----------------|
| pending | En attente | Médecin doit vérifier et accepter/rejeter |
| accepted | Acceptée | Médecin a validé, peut être implémentée |
| rejected | Rejetée | Médecin a refusé, reste configuration actuelle |
| expired | Expirée | Proposition pas traitée sous 30 jours |

**Stored in**: `AdjustmentProposal.status`

---

### DeviceCategory
Usage: Catégorie d'appareil médical synchronisable.

| Valeur | Signification | Exemple |
|--------|---------------|---------|
| glucometer | Glucomètre (capillaire) | OneTouch, Accu-Chek |
| cgm | Lecteur continu (FGM) | FreeStyle Libre, Dexcom |
| insulinPump | Pompe à insuline | Medtronic, Tandem |
| insulinPen | Stylo injecteur | NovoLog, Humalog |
| healthApp | Application santé | Apple Health, Google Fit |

**Stored in**: `PatientDevice.category`

---

### DocumentCategory
Usage: Classification des documents médicaux.

| Valeur | Signification | Audience |
|--------|---------------|----------|
| general | Générale | Visible patient + soignants |
| forDoctor | Réservée médecin | Visible médecin uniquement |
| personal | Personnelle | Visible patient uniquement |
| prescription | Ordonnance | Soignant prescripteur + pharmacie |
| labResults | Résultats de laboratoire | Soignant + patient |
| other | Autre | Défaut générique |

**Stored in**: `MedicalDocument.category`

---

### PushPlatform
Usage: Plateforme de destination des notifications push.

| Valeur | Signification | Token format |
|--------|---------------|--------------|
| ios | Apple iOS | FCM token (Apple Push) |
| android | Android | FCM token (Google) |
| web | Web (Progressive Web App) | FCM token |

**Stored in**: `PushDeviceRegistration.platform`, `PushNotificationLog.platform`

---

### PushNotifStatus
Usage: État de livraison d'une notification push.

| Valeur | Signification | Remarque |
|--------|---------------|----------|
| pending | En attente d'envoi | Notification en queue |
| sent | Envoyée au provider | Pas de garantie de livraison |
| delivered | Livrée au terminal | Confirmé par le provider |
| failed | Échec d'envoi | Erreur, voir `errorCode` |
| expired | Expirée | TTL dépassée, non envoyée |

**Stored in**: `PushNotificationLog.status`

---

### ScheduleType
Usage: Type de planification pour les notifications programmées.

| Valeur | Signification | Paramètre |
|--------|---------------|-----------|
| once | Une seule fois | `scheduledAt` |
| daily | Quotidien | `scheduledAt` (heure) |
| weekly | Hebdomadaire | `scheduledAt` (jour + heure) |
| custom_cron | Expression CRON custom | `cronExpression` |

**Stored in**: `PushScheduledNotification.scheduleType`

---

### IosInterruptionLevel
Usage: Niveau d'interruption des notifications iOS (impacte la vibration, son, affichage écran verrouillé).

| Valeur | Signification | Cas d'usage |
|--------|---------------|-----------|
| passive | Passif | Notification silencieuse en centre de notifications |
| active | Actif | Notification visible avec son/vibration |
| time_sensitive | Sensible au temps | Alerte avec son même en mode silencieux (hourly limite) |
| critical | Critique | Son/vibration continu, contourne mode silencieux (nécessite entitlement) |

**Stored in**: `PushNotificationTemplate.iosInterruptionLevel`

**Note**: `critical` réservé aux alertes hypoglycémiques critiques (< 54 mg/dL).

---

### AndroidPriority
Usage: Priorité des notifications Android (impacte le délai de livraison).

| Valeur | Signification | Délai |
|--------|---------------|-------|
| normal | Normale | Peut être délivrée avec délai (batching) |
| high | Haute | Livraison immédiate avec son |

**Stored in**: `PushNotificationTemplate.androidPriority`

---

### DiabetesEventType
Usage: Type d'événement saisi par le patient (peut être multiple par événement).

| Valeur | Signification | Champs associés |
|--------|---------------|-----------------|
| glycemia | Mesure glycémique | `glycemiaValue` (mg/dL ou g/L) |
| insulinMeal | Injection/bolus repas | `bolusDose`, `carbohydrates` |
| physicalActivity | Activité physique | `activityType`, `activityDuration` (min) |
| context | Contexte particulier | `contextType` (stress, maladie, règles, etc.) |
| occasional | Événement occasionnel | `comment` |

**Stored in**: `DiabetesEvent.eventTypes` (ARRAY of enums)

---

## Domaine 1 — Utilisateur & Authentification

Gère les utilisateurs du backoffice (médecins, infirmiers, administrateurs) et leurs sessions/préférences.

### Table: User

Profil utilisateur avec authentification, rôle, et données personnelles chiffrées.

**SQL name**: `users`

**Description**: Table centrale pour tous les utilisateurs du backoffice Diabeo (médecins, infirmiers, administrateurs). Contient l'authentification (email, passwordHash), les données personnelles partiellement chiffrées (conformité HDS/RGPD), et les flags de configuration (MFA, onboarding, consentements).

**Clés primaires/uniques**:
- `id` (PK)
- `emailHmac` (UNIQUE) — HMAC-SHA256 de l'email pour lookups sécurisés sans exposer l'email chiffré

**Relations**:
- 1:1 → `Patient` (1 User peut être 1 Patient)
- 1:1 → `UserUnitPreferences`
- 1:1 → `UserNotifPreferences`
- 1:1 → `UserPrivacySettings`
- 1:1 → `DashboardConfiguration`
- 1:N → `UserDayMoment`
- 1:N → `UiStateSave`
- 1:N → `Session`
- 1:N → `Account`
- 1:N → `DeviceDataSync`
- 1:N → `PushDeviceRegistration`
- 1:N → `PushNotificationLog`
- 1:N → `PushScheduledNotification`
- 1:N → `AuditLog`
- 1:N → `AdjustmentProposal` (via `reviewedBy`)

| Colonne | Type | Nullable | Default | Chiffré | Description |
|---------|------|----------|---------|---------|-------------|
| id | Int | N | autoincrement | N | Identifiant unique user |
| email | String | N | — | ✅ AES-256-GCM | Email en clair (jamais stocké, toujours déchiffré en mémoire) |
| emailHmac | String | N | — | N | HMAC-SHA256(email, HMAC_SECRET) — permet index UNIQUE pour lookups sans exposer email chiffré |
| passwordHash | String | N | — | N | Hash bcrypt du mot de passe (jamais l'email, toujours NIST guidelines) |
| title | String | Y | — | N | Titre civil: 'M.', 'Mme', 'Dr', 'Prof' |
| firstname | String | Y | — | ✅ AES-256-GCM | Prénom principal (chiffré pour HDS) |
| firstnames | String | Y | — | ✅ AES-256-GCM | Tous les prénoms (chiffré) |
| usedFirstname | String | Y | — | ✅ AES-256-GCM | Prénom utilisé au quotidien (peut différer de firstname) |
| lastname | String | Y | — | ✅ AES-256-GCM | Nom de famille (chiffré) |
| usedLastname | String | Y | — | ✅ AES-256-GCM | Nom utilisé au quotidien (peut différer de lastname) |
| birthday | Date | Y | — | ✅ AES-256-GCM | Date de naissance (type Date, format ISO) |
| sex | Sex | Y | — | N | Genre: M, F, X |
| codeBirthPlace | String | Y | — | ✅ AES-256-GCM | Code INSEE lieu de naissance (5 chiffres) |
| timezone | String | Y | Europe/Paris | N | Timezone user pour les reminders (ex: "Europe/London") |
| phone | String | Y | — | ✅ AES-256-GCM | Numéro téléphone (chiffré pour HDS) |
| address1 | String | Y | — | ✅ AES-256-GCM | Adresse ligne 1 (chiffré) |
| address2 | String | Y | — | ✅ AES-256-GCM | Adresse ligne 2 (chiffré) |
| cp | String | Y | — | ✅ AES-256-GCM | Code postal (chiffré) |
| city | String | Y | — | ✅ AES-256-GCM | Ville (chiffré) |
| country | Char(2) | Y | — | N | Code pays ISO 2 (ex: 'FR', 'BE') |
| pic | String | Y | — | N | URL photo de profil (OVH Object Storage) |
| language | Language | Y | fr | N | Langue: fr, en, ar |
| role | Role | N | VIEWER | N | Rôle RBAC: ADMIN, DOCTOR, NURSE, VIEWER |
| mfaSecret | String | Y | — | N | Secret TOTP base32 (stocké chiffré en prod via pgcrypto) |
| mfaEnabled | Boolean | N | false | N | Flag: authentification 2FA activée |
| hasSignedTerms | Boolean | N | false | N | Flag: utilisateur a accepté CGU |
| profileComplete | Boolean | N | false | N | Flag: profil rempli (tous champs obligatoires) |
| needDataPolicyUpdate | Boolean | N | false | N | Flag: mise à jour politique données requise |
| dataPolicyUpdate | Timestamptz | Y | — | N | Date d'acceptation de la nouvelle politique |
| needPasswordUpdate | Boolean | N | false | N | Flag: changement mot de passe requis (ex: expiration) |
| needOnboarding | Boolean | N | false | N | Flag: tutoriel onboarding à afficher |
| debug | Boolean | N | false | N | Flag: mode debug activé (dev/QA uniquement) |
| nirpp | String | Y | — | ✅ AES-256-GCM | **TRÈS SENSIBLE** — NIR (Numéro d'Inscription au Répertoire) si pro santé |
| nirppType | String | Y | — | N | Type NIR: 'nir', 'nia' (Numéro d'Identifiant Acteur), 'nir_key' |
| nirppPolicyholder | String | Y | — | ✅ AES-256-GCM | Numéro assuré si porteur de mutuelle (chiffré) |
| nirppPolicyholderType | String | Y | — | N | Type: 'beneficiary', 'beneficiary_3digits', etc. |
| oid | String | Y | — | N | OID (Object IDentifier) interne (jamais exposer en API) |
| ins | String | Y | — | ✅ AES-256-GCM | INS (Identité Nationale de Santé) — clé santé populationnelle chiffrée |
| intercomHash | String | Y | — | N | Hash pour tracking Intercom (interne, jamais exposer) |
| deploymentKey | String | Y | — | N | Clé de déploiement app mobile (interne) |
| pro | String | Y | — | N | Flag professionnel de santé (interne) |
| displayModalTlsMutual | Boolean | N | false | N | Flag: afficher modal TLS mutuel |
| displayModalTlsMandatory | Boolean | N | false | N | Flag: afficher modal TLS obligatoire |
| createdAt | Timestamptz | N | now() | N | Date de création du compte |
| updatedAt | Timestamptz | N | now() (auto-update) | N | Date de dernière modification |

**Indexes**:
- `PK: id`
- `UNIQUE: emailHmac` (pour lookups email sécurisés)
- `INDEX: createdAt` (pour requêtes type "users créés ce mois")

**Constraints**:
- FK: userId → Patient(userId) avec onDelete: Cascade

**Sécurité**:
- **Chiffrement applicatif**: Les champs marqués ✅ doivent être chiffrés AES-256-GCM avant insertion, base64 encodés pour stockage String
- **HMAC-SHA256**: `emailHmac` permet des indexes UNIQUE sans exposer l'email chiffré en clair
- **Audit**: Tout accès/modification loggé dans `AuditLog` (voir section audit)
- **MFA optionnelle**: Si `mfaEnabled=true`, TOTP requis après login

---

### Table: Account

Authentification externe NextAuth (OAuth2, GitHub, Google, etc.).

**SQL name**: `accounts`

**Description**: Table standard NextAuth v5 pour les authentifications externes (OAuth2, OpenID Connect). Stocke les tokens d'accès et d'actualisation du fournisseur.

**Relations**:
- N:1 → `User` (N comptes OAuth par user)

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (CUID) | N | cuid() | Identifiant unique (CUID format) |
| userId | Int | N | — | FK → `User.id` |
| type | String | N | — | Type authentification: 'oauth', 'credentials', 'webauthn' |
| provider | String | N | — | Fournisseur: 'github', 'google', 'apple', etc. |
| providerAccountId | String | N | — | ID du compte chez le provider (ex: GitHub username) |
| refreshToken | String | Y | — | Token d'actualisation du provider (peut expirer) |
| accessToken | String | Y | — | Token d'accès du provider (expires rapide) |
| expiresAt | Int | Y | — | Timestamp UNIX d'expiration du token (secondes) |
| tokenType | String | Y | — | Type token: 'Bearer', 'DPoP', etc. |
| scope | String | Y | — | Scopes OAuth demandés (ex: 'openid profile email') |
| idToken | String | Y | — | JWT ID token (OpenID Connect) |
| sessionState | String | Y | — | Session state (OIDC) |

**Unique constraints**:
- `UNIQUE(provider, providerAccountId)` — 1 compte externe par provider

---

### Table: Session

Sessions utilisateur NextAuth v5 (gestion de la connexion).

**SQL name**: `sessions`

**Description**: Table NextAuth v5 standard pour les sessions en base de données. Remplace les cookies de session par du stateless JWT + validation DB.

**Relations**:
- N:1 → `User` (1 user peut avoir N sessions simultanées)

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (CUID) | N | cuid() | Identifiant unique session |
| sessionToken | String | N | — | Token de session (jeton opaque signé) |
| userId | Int | N | — | FK → `User.id` |
| expires | Timestamptz | N | — | Date d'expiration de la session (ex: now() + 30 days) |

**Unique constraints**:
- `UNIQUE(sessionToken)` — Un seul token par session

**Notes**:
- Toute création/modification de session doit auditer dans `AuditLog`
- Suppression session = invalidation immédiate

---

### Table: VerificationToken

Tokens de vérification (email, MFA, reset password).

**SQL name**: `verification_tokens`

**Description**: Tokens à usage unique pour les workflows asynchrones: confirmation email, reset password, ajout 2FA, etc. Expire après utilisation ou délai (ex: 24h).

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| identifier | String | N | — | Identifiant: email ou userId (clé métier) |
| token | String | N | — | Token cryptographiquement aléatoire (base32 ou UUID) |
| expires | Timestamptz | N | — | Date d'expiration du token (ex: now() + 24 hours) |

**Unique constraints**:
- `UNIQUE(identifier, token)` — 1 token par (email, token) pair

**Lifecycle**:
1. User demande reset password → création token
2. Email envoyé avec lien `/api/auth/reset-password?token=...&identifier=...`
3. User clique lien → token validé et supprimé immédiatement
4. Tokens expirés nettoyés par cron quotidien

---

### Table: UserUnitPreferences

Préférences d'unités de mesure (glucose mg/dL vs g/L, poids kg vs lbs, etc.).

**SQL name**: `user_unit_preferences`

**Description**: Chaque user peut configurer les unités de sa préférence. Les données brutes restent toujours en g/L en base, converties à l'affichage selon les préférences.

**Relations**:
- 1:1 → `User`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| userId | Int | N | — | FK → `User.id` (UNIQUE 1:1) |
| unitGlycemia | Int | N | 5 | Code unité glucose: 3=g/L, 4=mg/dL, 5=mmol/L |
| unitWeight | Int | N | 6 | Code unité poids: 6=kg, 7=lbs |
| unitSize | Int | N | 8 | Code unité taille: 8=cm, 9=ft |
| unitCarb | Int | N | 2 | Code unité glucides: 1=CP (Carb Portion), 2=g |
| unitHba1c | Int | N | 10 | Code unité HbA1c: 10=%, 11=mmol/mol |
| unitCarbExchangeNb | Int | N | 15 | Code unité portion échangeables |
| unitKetones | Int | N | 12 | Code unité cétones: 12=mmol/L, 13=mg/dL |
| unitBloodPressure | Int | N | 14 | Code unité pression: 14=mmHg |

**Notes**:
- Les codes unit (3-15) referencent `UnitDefinition.unitCode`
- Lookup via `GET /api/units` pour le tableau de correspondance
- Conversion applicative au runtime (pas en DB)

---

### Table: UserNotifPreferences

Préférences de notifications (email, rappels glycémie/insuline, rendez-vous).

**SQL name**: `user_notification_preferences`

**Description**: Configuration des notifications par user (email, SMS, push). Respecte opt-in/opt-out RGPD.

**Relations**:
- 1:1 → `User`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| userId | Int | N | — | FK → `User.id` (UNIQUE 1:1) |
| notifMessageMail | Boolean | N | true | Notifications de messages par email |
| notifDocumentMail | Boolean | N | true | Notifications de documents par email |
| glycemiaReminders | Boolean | N | false | Rappels de mesure glycémie activés |
| glycemiaReminderTimes | Json | Y | — | Array JSON des horaires de rappel (ex: ["08:00", "12:00", "20:00"]) |
| insulinReminders | Boolean | N | false | Rappels injection insuline activés |
| insulinReminderTimes | Json | Y | — | Array JSON des horaires de rappel insuline |
| medicalAppointments | Boolean | N | true | Notifications rendez-vous médicaux |
| autoExport | Boolean | N | false | Export automatique des données activé |
| autoExportFrequency | Int | Y | — | Fréquence export (jours) si autoExport=true |

---

### Table: UserPrivacySettings

Consentements RGPD et préférences de partage de données.

**SQL name**: `user_privacy_settings`

**Description**: Gestion des consentements requis par RGPD Article 7 et Article 9 (données sensibles). Chaque modification doit être tracée dans `AuditLog`.

**Relations**:
- 1:1 → `User`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| userId | Int | N | — | FK → `User.id` (UNIQUE 1:1) |
| shareWithResearchers | Boolean | N | false | Partage données anonymisées avec chercheurs |
| shareWithProviders | Boolean | N | true | Partage données avec soignants (équipe médicale) |
| analyticsEnabled | Boolean | N | true | Cookies/analytics activés |
| gdprConsent | Boolean | N | false | **REQUIS** — Consentement explicite Article 7 (traitement données) |
| consentDate | Timestamptz | Y | — | Date d'acceptation des consentements (auto-set si gdprConsent=true) |

**Règles métier**:
- `gdprConsent=true` requis pour accéder aux données patients/CGM
- Tout changement audité (user_id, ancien_consentement, nouveau_consentement)

---

### Table: UserDayMoment

Moments personnalisés du jour (petit-déj, déj, goûter, dîner, etc.).

**SQL name**: `user_day_moments`

**Description**: Permet la personnalisation des rappels et des objectifs glycémiques selon les moments du jour. Peut combiner présets (morning, noon) avec custom.

**Relations**:
- N:1 → `User`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| userId | Int | N | — | FK → `User.id` |
| type | DayMomentType | N | — | Type: morning, noon, evening, night, custom |
| startTime | Time | N | — | Heure de début (ex: "06:00:00") |
| endTime | Time | N | — | Heure de fin (ex: "12:00:00") |
| isCustom | Boolean | N | false | Flag: moment personnalisé (custom) vs preset |

**Unique constraints**:
- `UNIQUE(userId, type)` — 1 moment de chaque type par user

---

### Table: UiStateSave

Sauvegarde d'état UI (filtre actif, onglet sélectionné, etc.).

**SQL name**: `ui_state_save`

**Description**: Persistance d'état UI côté serveur (plutôt que localStorage) pour synchroniser l'état entre appareils. Exemple: dernier filtre utilisé en liste patients.

**Relations**:
- N:1 → `User`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| userId | Int | N | — | FK → `User.id` |
| key | VarChar(100) | N | — | Clé d'état (ex: "patients_list_filter", "selected_patient_id") |
| value | VarChar(255) | Y | — | Valeur sérializée (JSON string ou valeur simple) |

**Unique constraints**:
- `UNIQUE(userId, key)` — 1 valeur par (user, key)

---

## Domaine 2 — Patient & Données Médicales

Gère les profils patients et leurs données médicales (antécédents, comorbidités, grossesse).

### Table: Patient

Profil patient diabétique.

**SQL name**: `patients`

**Description**: Chaque patient (user avec role=VIEWER ou pathology définie) a un profil. Contient le lien user (1:1) et l'historique des patients supprimés (soft delete RGPD).

**Relations**:
- 1:1 → `User`
- 1:1 → `PatientMedicalData`
- 1:1 → `PatientAdministrative`
- 1:1 → `CgmObjective`
- 1:1 → `AnnexObjective`
- 1:1 → `InsulinTherapySettings`
- 1:N → `PatientPregnancy`
- 1:N → `GlycemiaObjective`
- 1:N → `Treatment`
- 1:N → `BolusCalculationLog`
- 1:N → `AdjustmentProposal`
- 1:N → `CgmEntry`
- 1:N → `GlycemiaEntry`
- 1:N → `DiabetesEvent`
- 1:N → `InsulinFlowEntry`
- 1:N → `InsulinFlowDeviceData`
- 1:N → `PumpEvent`
- 1:N → `AverageData`
- 1:N → `PatientDevice`
- 1:N → `PatientService`
- 1:1 → `PatientReferent`
- 1:N → `MedicalDocument`
- 1:N → `Appointment`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique patient |
| userId | Int | N | — | FK → `User.id` (UNIQUE 1:1, cascade delete) |
| pathology | Pathology | N | — | Type diabète: DT1, DT2, GD |
| createdAt | Timestamptz | N | now() | Date création profil patient |
| deletedAt | Timestamptz | Y | — | **Soft delete RGPD** — NULL=actif, valeur=supprimé |

**Indexes**:
- `PK: id`
- `UNIQUE: userId`
- `INDEX: deletedAt` (pour requêtes WHERE deletedAt IS NULL)

**Soft delete pattern**:
- Toute requête patient doit utiliser `WHERE deletedAt IS NULL`
- Suppression: `UPDATE patient SET deletedAt = NOW() WHERE id = ?`
- Trigger PostgreSQL anonymise les données chiffrées après soft delete (voir `prisma/sql/audit_immutability.sql`)

---

### Table: PatientMedicalData

Antécédents médicaux, comorbidités, allergies, facteurs de risque.

**SQL name**: `patient_medical_data`

**Description**: Données médicales complètes et sensibles du patient (antécédents chirurgicaux, allergies, habitudes toxiques). **Tous les champs d'historique sont chiffrés AES-256-GCM**.

**Relations**:
- 1:1 → `Patient`

| Colonne | Type | Nullable | Default | Chiffré | Description |
|---------|------|----------|---------|---------|-------------|
| id | Int | N | autoincrement | N | Identifiant unique |
| patientId | Int | N | — | N | FK → `Patient.id` (UNIQUE 1:1) |
| dt1 | Boolean | Y | — | N | Flag: Type 1 diagnostiqué |
| size | Decimal(5,2) | Y | — | N | Taille en cm (ex: 175.50) |
| yearDiag | Int | Y | — | N | Année de diagnostic diabète (ex: 2015) |
| insulin | Boolean | Y | — | N | Flag: Patient sous insuline |
| insulinYear | Int | Y | — | N | Année début insuline (ex: 2018) |
| insulinPump | Boolean | Y | — | N | Flag: Patient avec pompe à insuline |
| pathology | String(100) | Y | — | N | Description texte pathologie si autre |
| diabetDiscovery | String | Y | — | N | Contexte découverte: "asymptomatique", "cétoacidose", etc. |
| tabac | Boolean | Y | — | N | Flag: Patient fumeur/ancien fumeur |
| alcool | Boolean | Y | — | N | Flag: Consommation alcool régulière |
| historyMedical | String | Y | — | ✅ AES-256-GCM | **SENSIBLE** — Antécédents médicaux (HTA, cardiopathie, etc., chiffré) |
| historyChirurgical | String | Y | — | ✅ AES-256-GCM | **SENSIBLE** — Antécédents chirurgicaux (chiffré) |
| historyFamily | String | Y | — | ✅ AES-256-GCM | **SENSIBLE** — Antécédents familiaux (diabète, cancer, etc., chiffré) |
| historyAllergy | String | Y | — | ✅ AES-256-GCM | **SENSIBLE** — Allergies (médicamenteuses, autres, chiffré) |
| historyVaccine | String | Y | — | ✅ AES-256-GCM | **SENSIBLE** — Vaccinations (dates, réactions, chiffré) |
| historyLife | String | Y | — | ✅ AES-256-GCM | **SENSIBLE** — Conditions de vie (profession, loisirs, environnement, chiffré) |
| riskWeight | Boolean | N | false | N | Flag: Surpoids/obésité |
| riskTension | Boolean | N | false | N | Flag: Hypertension |
| riskSedent | Boolean | N | false | N | Flag: Sédentarité |
| riskCholesterol | Boolean | N | false | N | Flag: Dyslipidémie |
| riskAge | Boolean | N | false | N | Flag: Âge avancé (> 65 ans) |
| riskHeredit | Boolean | N | false | N | Flag: Antécédent familial |
| riskCardio | Boolean | N | false | N | Flag: Maladie cardiovasculaire |
| riskHypothyroidism | Boolean | N | false | N | Flag: Hypothyroïdie/thyroïdite |
| riskCeliac | Boolean | N | false | N | Flag: Maladie cœliaque |
| riskOtherAutoimmune | Boolean | N | false | N | Flag: Autres maladies auto-immunes |
| vitaleAttest | String | Y | — | N | Attestation Vitale (numéro de dossier) |

---

### Table: PatientAdministrative

Données administratives et sociales (ALD, mutuelle, maternité).

**SQL name**: `patient_administrative`

**Description**: Informations administratives pour facturation et statut légal (ALD, couverture mutuelle, grossesse déclarée).

**Relations**:
- 1:1 → `Patient`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` (UNIQUE 1:1) |
| regimeAld | Boolean | N | false | Flag: Affection Longue Durée (exemption ticket modérateur si true) |
| dateStartMaternite | Date | Y | — | Date début congé maternité (indique grossesse déclarée) |
| hasMutual | Boolean | N | false | Flag: Couverture mutuelle |
| mutualFileRecto | VarChar(500) | Y | — | URL fichier recto carte mutuelle (OVH Object Storage) |
| mutualFileVerso | VarChar(500) | Y | — | URL fichier verso carte mutuelle |

---

### Table: PatientPregnancy

Suivi des grossesses (pour patient pathology=GD ou DT1/DT2 enceinte).

**SQL name**: `patient_pregnancy`

**Description**: Enregistrement des grossesses actives ou antérieures. Utile pour adapter la stratégie insulinothérapie (cibles plus serrées en GD).

**Relations**:
- N:1 → `Patient` (une patient peut avoir N grossesses)

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| active | Boolean | N | true | Flag: Grossesse actuellement en cours |
| dueDate | Date | Y | — | Date de terme prévue (DPA) |
| gestationalAge | Int | Y | — | Âge gestationnel en semaines (0-45) |
| notes | String | Y | — | Notes cliniques (ex: "grossesse compliquée par HTA") |
| createdAt | Timestamptz | N | now() | Date création enregistrement |

**Règles métier**:
- Créer une grossesse → désactiver la précédente (`UPDATE ... SET active=false WHERE patientId=? AND active=true`)
- `gestationalAge` validé: [0-45] semaines
- `dueDate` doit être après la date courante (future)

---

## Domaine 3 — Configuration Insulinothérapie

Gère les paramètres d'insulinothérapie: catalogue des insulines, ratios ISF/ICR horaires, configurations basales, cibles glycémiques.

### Table: InsulinCatalog

Catalogue de référence des insulines commerciales avec leurs propriétés pharmacocinétiques.

**SQL name**: `insulin_catalog`

**Description**: Table en lecture seule préremplie par seed. Contient les 17 insulines commerciales disponibles avec leurs données pharmacocinétiques validées (sources FDA/EMA). Utilisée pour la sélection de l'insuline bolus/basale dans InsulinTherapySettings et pour informer les calculs de durée d'action (IOB).

**Relations**: Aucune relation directe. Table de référence consultée par l'application.

| Colonne | SQL name | Type PostgreSQL | Nullable | Default | Chiffré | Description |
|---------|----------|-----------------|----------|---------|---------|-------------|
| id | id | SERIAL | Non | autoincrement | Non | Identifiant unique |
| displayName | display_name | VARCHAR(100) | Non | — | Non | Nom commercial (ex: "Humalog", "Lantus"). Contrainte UNIQUE. |
| genericName | generic_name | VARCHAR(100) | Non | — | Non | Dénomination Commune Internationale / DCI (ex: "insulin lispro", "insulin glargine U-100") |
| typicalOnsetMinutes | typical_onset_minutes | INT | Non | — | Non | Début d'action typique en minutes après injection. Ultra-rapide: 3-5 min, rapide: 15 min, régulière: 30 min, longue: 60-360 min. Source: FDA prescribing information. |
| typicalPeakMinutes | typical_peak_minutes | INT | Oui | — | Non | Pic d'action en minutes. NULL pour les insulines basales sans pic (glargine, degludec). Levemir a un pic modeste à ~480 min. |
| typicalDurationHours | typical_duration_hours | DECIMAL(4,1) | Non | — | Non | Durée d'action totale en heures. Rapide: 4-5h, régulière: 8h, NPH: 16h, longue: 20-42h. Paramètre clé pour le calcul IOB. |
| isFasterActing | is_faster_acting | BOOLEAN | Non | false | Non | Ultra-rapide (Fiasp, Lyumjev). Onset < 10 min grâce à des excipients accélérateurs (niacinamide, tréprostinil). |
| isTraditionalRapidActing | is_traditional_rapid_acting | BOOLEAN | Non | false | Non | Rapide classique (Humalog, NovoRapid, Apidra). Onset ~15 min, durée ~5h. Utilisé pour le bolus repas et correction. |
| isLongActing | is_long_acting | BOOLEAN | Non | false | Non | Insuline basale longue durée (Lantus, Levemir, Tresiba, Toujeo, Basaglar). Ne doit PAS apparaître dans le calculateur de bolus. |
| approvalYear | approval_year | INT | Oui | — | Non | Année de première approbation FDA ou EMA. Référence historique. |
| manufacturer | manufacturer | VARCHAR(100) | Oui | — | Non | Fabricant pharmaceutique (Eli Lilly, Novo Nordisk, Sanofi). |
| isActive | is_active | BOOLEAN | Non | true | Non | Permet de désactiver une insuline du catalogue sans suppression physique. |
| createdAt | created_at | TIMESTAMPTZ | Non | now() | Non | Date de création de l'entrée. |

**Contraintes et index**:
- `display_name` : UNIQUE — une seule entrée par nom commercial.

**Données préremplies (seed)** — 17 insulines réparties en 7 catégories :

| Catégorie | Insulines | Onset (PD) | Pic (PD) | Durée | Règle |
|-----------|-----------|-----------|----------|-------|-------|
| Ultra-rapide | Fiasp, Lyumjev | 15-16 min | 91-120 min | 4.6-5.0h | Courte |
| Rapide | Humalog, NovoRapid, Apidra | 15 min | 60-90 min | 3.0h | Courte |
| Régulière | Humulin R, Actrapid | 30 min | 150 min | 5.0h | Courte |
| Intermédiaire (NPH) | Humulin N, Insulatard | 90 min | 420 min | 24.0h | Longue |
| Longue durée | Lantus, Basaglar | 90 min | sans pic | 24.0h | Longue |
| Longue durée | Toujeo (U-300) | 360 min | sans pic | 36.0h | Longue |
| Longue durée | Levemir | 180 min | 420 min | 24.0h | Longue |
| Ultra-longue | Tresiba | 60 min | sans pic | 42.0h | Longue |
| Pré-mélangée | Humalog Mix 25, NovoMix 30 | 15 min | 120 min | 22-24h | Longue |
| Concentrée | Humulin R U-500 | 30 min | 240 min | 24.0h | Longue |

**Règles métier**:
- Table en lecture seule — les utilisateurs ne peuvent pas ajouter d'insulines via l'API.
- Seules les insulines `isActive = true` sont proposées dans les sélecteurs.
- Les insulines `isLongActing = true` ne doivent JAMAIS apparaître dans le calculateur de bolus.
- `typicalDurationHours` alimente le calcul IOB (Insulin On Board) dans `insulin.service.ts`.
- Pour les insulines sans pic (`typicalPeakMinutes = NULL`), le modèle IOB doit utiliser une courbe de décroissance plate.

**Convention durées** :
- Insulines rapides/ultra-rapides : durée la plus **courte** de la plage documentée (sécurité IOB — éviter sous-estimation de l'insuline restante)
- Insulines basales/longue durée : durée la plus **longue** de la plage documentée (couverture maximale)
- Toutes les valeurs sont **pharmacodynamiques** (effet glycémique), pas pharmacocinétiques (concentration sérique)

**Sources cliniques vérifiées** :
- [Fiasp FDA DailyMed (NDA 208751)](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=834e7efc-393f-4c55-9125-628562a8a5cf) — onset PD 16-20min, peak PD 91-133min, duration 5-7h
- [Lyumjev FDA DailyMed (NDA 761109)](https://dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=c5a056e2-b568-4ca6-9ed8-79c010942d00) — onset PD 15-17min, peak PD 120-174min, duration 4.6-7.3h
- [Tresiba FDA DailyMed (NDA 203314)](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=456c5e87-3dfd-46fa-8ac0-c6128d4c97c6) — duration ≥42h, half-life 25h
- [Toujeo FDA DailyMed](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=c9561d96-124d-48ca-982f-0aa1575bff36) — onset 6h, serum detectable beyond 36h
- [Endotext Table 3 — Insulin Pharmacology (NCBI NBK278938)](https://www.ncbi.nlm.nih.gov/books/NBK278938/) — tableau comparatif toutes insulines
- [Vidal — Fiasp](https://www.vidal.fr/actualites/22513-diabete-de-l-adulte-fiasp-insuline-asparte-nouvelle-insuline-d-action-rapide.html) — onset 5-15min, pic 1-3h, durée 3-5h

### Table: PatientInsulin

Insulines utilisées par un patient avec durée d'action personnalisable et historique.

**SQL name**: `patient_insulins`

**Description**: Lie un patient à ses insulines du catalogue. Chaque patient peut avoir plusieurs insulines actives simultanément (typiquement une rapide + une basale). La durée d'action peut être personnalisée par le médecin pour ce patient spécifique (override du catalogue). L'historique est conservé via `startDate`/`endDate` — quand on change d'insuline, l'ancienne est désactivée (pas supprimée).

**Relations**:
- N:1 → `Patient`
- N:1 → `InsulinCatalog` (référence pharmacocinétique)
- N:1 → `User` (médecin prescripteur, optionnel)
- 1:N → `InsulinTherapySettings` (comme bolus ou basal)

| Colonne | SQL name | Type PostgreSQL | Nullable | Default | Chiffré | Description |
|---------|----------|-----------------|----------|---------|---------|-------------|
| id | id | SERIAL | Non | autoincrement | Non | Identifiant unique |
| patientId | patient_id | INT | Non | — | Non | FK → `Patient.id` |
| insulinCatalogId | insulin_catalog_id | INT | Non | — | Non | FK → `InsulinCatalog.id` — référence pharmacocinétique |
| usage | usage | InsulinUsage | Non | — | Non | Rôle de l'insuline : `bolus`, `basal`, ou `both` (pré-mélangées) |
| customDurationHours | custom_duration_hours | DECIMAL(4,1) | Oui | — | Non | Durée d'action personnalisée en heures. Si NULL, utiliser `InsulinCatalog.typicalDurationHours`. C'est cette valeur qui alimente le calcul IOB. |
| customOnsetMinutes | custom_onset_minutes | INT | Oui | — | Non | Onset personnalisé en minutes. Si NULL, utiliser `InsulinCatalog.typicalOnsetMinutes`. |
| dosage | dosage | VARCHAR(100) | Oui | — | Non | Posologie libre (ex: "18U le soir", "6-8U avant repas") |
| isActive | is_active | BOOLEAN | Non | true | Non | Insuline active dans le traitement actuel. `false` = arrêtée. |
| startDate | start_date | DATE | Non | now() | Non | Date de début d'utilisation |
| endDate | end_date | DATE | Oui | — | Non | Date de fin d'utilisation. NULL = en cours. Rempli quand on arrête l'insuline. |
| prescribedBy | prescribed_by | INT | Oui | — | Non | FK → `User.id` (rôle DOCTOR). Médecin ayant prescrit cette insuline. |
| notes | notes | TEXT | Oui | — | **Oui** | Notes cliniques sur cette insuline pour ce patient. Chiffré AES-256-GCM. |
| createdAt | created_at | TIMESTAMPTZ | Non | now() | Non | Date de création |
| updatedAt | updated_at | TIMESTAMPTZ | Non | auto | Non | Date de dernière modification |

**Contraintes et index**:
- `(patient_id, is_active)` — index pour requête rapide des insulines actives d'un patient
- `(patient_id, insulin_catalog_id)` — index pour vérification doublons

**Règles métier**:
- Un patient peut avoir plusieurs insulines actives simultanément (pas de maximum)
- Quand on arrête une insuline, on met `isActive = false` et `endDate = today` (pas de suppression physique)
- `customDurationHours` est prioritaire sur `InsulinCatalog.typicalDurationHours` pour le calcul IOB
- Le patient ET le médecin peuvent modifier `customDurationHours`
- `notes` est chiffré AES-256-GCM car peut contenir des informations cliniques sensibles

**Calcul IOB** :
```typescript
// Résolution de la durée d'action pour un patient
const durationHours = patientInsulin.customDurationHours
  ?? patientInsulin.insulinCatalog.typicalDurationHours
```

---

### Table: InsulinTherapySettings

Configuration racine de l'insulinothérapie (insulines actives, type livraison).

**SQL name**: `insulin_therapy_settings`

**Description**: Configuration centrale par patient. Pointe vers les insulines bolus et basale actives du patient (via `PatientInsulin`), et définit le mode de livraison (pompe ou injection manuelle).

**Relations**:
- 1:1 → `Patient`
- N:1 → `PatientInsulin` (insuline bolus active)
- N:1 → `PatientInsulin` (insuline basale active)
- 1:1 → `IobSettings`
- 1:1 → `ExtendedBolusSettings`
- 1:1 → `BasalConfiguration`
- 1:N → `GlucoseTarget`
- 1:N → `InsulinSensitivityFactor`
- 1:N → `CarbRatio`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` (UNIQUE 1:1) |
| bolusInsulinId | Int | Y | — | FK → `PatientInsulin.id` — insuline bolus active du patient |
| basalInsulinId | Int | Y | — | FK → `PatientInsulin.id` — insuline basale active du patient |
| deliveryMethod | InsulinDeliveryMethod | N | — | Méthode livraison: pump, manual |
| lastModified | Timestamptz | N | now() | Date dernière modification config (audit) |
| createdAt | Timestamptz | N | now() | Date création config |

**Note** : `insulinActionDuration` a été supprimé — la durée d'action est maintenant dans `PatientInsulin.customDurationHours` (personnalisable par patient) avec fallback sur `InsulinCatalog.typicalDurationHours`.

**Indexes**:
- `PK: id`
- `UNIQUE: patientId`

---

### Table: GlucoseTarget

Cibles glycémiques (peuvent être multiples, une active à la fois).

**SQL name**: `glucose_targets`

**Description**: Objectifs glycémiques horaires ou généraux. Peut avoir plusieurs configurations (standard, serré, pédiatrique, etc.), une seule marquée `isActive=true`.

**Relations**:
- N:1 → `InsulinTherapySettings`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| settingsId | Int | N | — | FK → `InsulinTherapySettings.id` |
| targetGlucose | Decimal(6,2) | N | — | Cible glycémique centrale (mg/dL, ex: 120.00) |
| targetRangeLower | Decimal(4,2) | N | 0.70 | Seuil bas plage (g/L, ex: 0.70 = 70 mg/dL) |
| targetRangeUpper | Decimal(4,2) | N | 1.80 | Seuil haut plage (g/L, ex: 1.80 = 180 mg/dL) |
| preset | GlucoseTargetPreset | Y | — | Préset: standard, tight, pediatric, elderly, custom |
| isActive | Boolean | N | true | Flag: Configuration actuellement active |
| createdAt | Timestamptz | N | now() | Date création cible |

**Règles**:
- `targetRangeLower < targetRangeUpper` (validation Zod)
- Toujours utiliser en g/L (conversion mg/dL en application)

---

### Table: IobSettings

Paramètres d'Insulin On Board (IOB = insuline active dans le corps).

**SQL name**: `iob_settings`

**Description**: Configuration du calcul IOB pour ajuster les bolus en fonction de l'insuline résiduelle. Actuellement placeholder (IOB = 0).

**Relations**:
- 1:1 → `InsulinTherapySettings`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| settingsId | Int | N | — | FK → `InsulinTherapySettings.id` (UNIQUE 1:1) |
| considerIob | Boolean | N | true | Flag: IOB pris en compte dans calcul bolus |
| actionDurationHours | Decimal(4,2) | N | 4.0 | Durée d'action insuline (heures) pour calcul IOB |

**Note**: IOB implémentation réelle TBD (actuellement `iobAdjustment = 0` dans `BolusCalculationLog`).

---

### Table: ExtendedBolusSettings

Paramètres de bolus étendu (demi-immediat, demi-diffusé sur 2h).

**SQL name**: `extended_bolus_settings`

**Description**: Configuration pour le bolus étendu (extended/dual bolus), utile pour repas gras/protéinés. Pompe uniquement.

**Relations**:
- 1:1 → `InsulinTherapySettings`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| settingsId | Int | N | — | FK → `InsulinTherapySettings.id` (UNIQUE 1:1) |
| enabled | Boolean | N | false | Flag: Bolus étendu autorisé |
| immediatePercentage | Decimal(5,2) | N | 100.0 | % bolus immédiat (0-100%, ex: 50 = moitié immédiate) |
| extendedDurationHours | Decimal(4,2) | Y | — | Durée diffusion partie étendue (heures) |

---

### Table: InsulinSensitivityFactor

Facteur de sensibilité insuline (ISF) par tranche horaire.

**SQL name**: `insulin_sensitivity_factors`

**Description**: **CRITIQUE** — Ratio insuline-correction pour chaque heure du jour. Ex: ISF=0.40 g/L/U veut dire 1 unité insuline baisse glucose de 0.40 g/L (40 mg/dL).

**Relations**:
- N:1 → `InsulinTherapySettings`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| settingsId | Int | N | — | FK → `InsulinTherapySettings.id` |
| startHour | SmallInt | N | — | Heure de début (0-23, ex: 8 = 08:00) |
| endHour | SmallInt | N | — | Heure de fin (0-23, ex: 12 = 12:00) |
| startTime | Time | N | — | Heure de début lisible (ex: "08:00:00") |
| endTime | Time | N | — | Heure de fin lisible (ex: "12:00:00") |
| sensitivityFactorGl | Decimal(6,4) | N | — | ISF en g/L/U (ex: 0.40 = 1U abaisse glucose de 0.40 g/L) |
| sensitivityFactorMgdl | Decimal(6,2) | N | — | ISF en mg/dL/U (ex: 40.0) — *conversion auto de sensitivityFactorGl* |
| createdAt | Timestamptz | N | now() | Date création |
| updatedAt | Timestamptz | N | now() | Date modification |

**Indexes**:
- `INDEX(settingsId, startHour)` — lookup rapide pour heure courante

**Règles métier**:
- Slots ordonnés par `startHour` ascendant (00:00 → 23:00)
- Sélection: premier slot où `startHour <= heure_courante`
- Fallback: dernier slot (minuit)
- **Validation clinique**: ISF ∈ [0.20, 1.00] g/L/U (voir `CLINICAL_BOUNDS` dans `insulin.service.ts`)
- ❌ **TODO**: Empêcher chevauchements horaires

---

### Table: CarbRatio

Ratio insuline-glucides (ICR) par tranche horaire.

**SQL name**: `carb_ratios`

**Description**: Ratio pour calcul bolus repas. Ex: ICR=10 g/U veut dire 1 unité couvre 10g glucides.

**Relations**:
- N:1 → `InsulinTherapySettings`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| settingsId | Int | N | — | FK → `InsulinTherapySettings.id` |
| startHour | SmallInt | N | — | Heure de début (0-23) |
| endHour | SmallInt | N | — | Heure de fin (0-23) |
| startTime | Time | N | — | Heure lisible (ex: "12:00:00") |
| endTime | Time | N | — | Heure lisible (ex: "14:00:00") |
| gramsPerUnit | Decimal(5,2) | N | — | ICR: grammes glucides par unité insuline (ex: 10.0) |
| mealLabel | VarChar(50) | Y | — | Nom du moment (ex: "Déjeuner", "Petit-déj") |
| createdAt | Timestamptz | N | now() | Date création |
| updatedAt | Timestamptz | N | now() | Date modification |

**Indexes**:
- `INDEX(settingsId, startHour)`

**Règles métier**:
- **Validation clinique**: ICR ∈ [5.0, 20.0] g/U
- Même pattern slot que ISF

---

### Table: BasalConfiguration

Configuration générale de l'insuline basale.

**SQL name**: `basal_configurations`

**Description**: Profil basal (pompe, injection simple, ou injections fractionnées). Référence les slots horaires si pompe.

**Relations**:
- 1:1 → `InsulinTherapySettings`
- 1:N → `PumpBasalSlot`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| settingsId | Int | N | — | FK → `InsulinTherapySettings.id` (UNIQUE 1:1) |
| configType | BasalConfigType | N | — | Type: pump, single_injection, split_injection |
| insulinBrand | VarChar(50) | N | — | Marque insuline basale (ex: "Lantus", "Omnipod") |
| totalDailyDose | Decimal(6,2) | Y | — | Dose basale quotidienne totale (U, ex: 15.5) |
| morningDose | Decimal(5,2) | Y | — | Dose matin si split_injection (U, ex: 8.0) |
| eveningDose | Decimal(5,2) | Y | — | Dose soir si split_injection (U, ex: 7.5) |
| dailyDose | Decimal(5,2) | Y | — | Dose si single_injection (U, ex: 20.0) |
| createdAt | Timestamptz | N | now() | Date création |

**Rules**:
- Si `configType=pump`: Ne pas utiliser morningDose/eveningDose, utiliser `PumpBasalSlot` à la place
- Si `configType=split_injection`: morningDose + eveningDose = totalDailyDose
- Validation DB: voir `prisma/sql/basal_config_check.sql`

---

### Table: PumpBasalSlot

Slot basal horaire pour pompe à insuline (profil basal à 24 points).

**SQL name**: `pump_basal_slots`

**Description**: Chaque slot définit le débit basal (U/h) pour une tranche horaire. Pompe 24h programmable avec généralement 48-96 slots possible, mais souvent utilisé 8-16 slots pour simplicité.

**Relations**:
- N:1 → `BasalConfiguration`
- 1:N → `AdjustmentProposal` (si proposal = modification basal)

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| basalConfigId | Int | N | — | FK → `BasalConfiguration.id` |
| startTime | Time | N | — | Heure début slot (ex: "00:00:00") |
| endTime | Time | N | — | Heure fin slot (ex: "06:00:00") |
| rate | Decimal(5,3) | N | — | Débit basal en U/h (ex: 0.500) |
| durationHours | Decimal(5,2) | Y | — | Durée du slot en heures (calculée: endTime - startTime) |
| createdAt | Timestamptz | N | now() | Date création |

**Indexes**:
- `PK: id`

**Règles**:
- Slots ordonnés et contigus (pas de trous, pas de chevauchements)
- Somme `(rate * duration)` sur 24h = totalDailyDose
- **Validation DB**: `basal_config_check.sql` trigger enforce

---

### Table: BolusCalculationLog

Journal immuable des bolus calculés.

**SQL name**: `bolus_calculation_logs`

**Description**: **CRITIQUE & IMMUABLE** — Chaque suggestion de bolus est loggée (jamais injectée sans acceptation). Contient tous les paramètres du calcul pour traçabilité.

**Relations**:
- N:1 → `Patient`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| calculatedAt | Timestamptz | N | now() | Timestamp du calcul |
| inputGlucoseGl | Decimal(6,4) | Y | — | Glycémie mesurée (g/L, ex: 1.50) |
| inputCarbsGrams | Decimal(6,2) | Y | — | Glucides estimés (g, ex: 45.0) |
| targetGlucoseMgdl | Decimal(6,2) | N | — | Cible glycémique utilisée (mg/dL, ex: 120.0) |
| isfUsedGl | Decimal(6,4) | N | — | ISF appliqué (g/L/U, ex: 0.40) |
| icrUsed | Decimal(5,2) | N | — | ICR appliqué (g/U, ex: 10.0) |
| mealBolus | Decimal(5,2) | N | 0 | Bolus repas (U, ex: 4.50) = inputCarbsGrams / icrUsed |
| rawCorrectionDose | Decimal(5,2) | N | 0 | Correction brute (U) = (inputGlucoseGl - target) / isfUsedGl |
| iobValue | Decimal(5,2) | N | 0 | IOB résiduelle (U, actuel placeholder = 0) |
| iobAdjustment | Decimal(5,2) | N | 0 | Ajustement IOB (U, soustrait de correction) |
| correctionDose | Decimal(5,2) | N | 0 | Correction finale (U) = max(0, rawCorrectionDose - iobAdjustment) |
| recommendedDose | Decimal(5,2) | N | — | **Bolus final recommandé** (U) = mealBolus + correctionDose, capé à MAX_SINGLE_BOLUS |
| wasCapped | Boolean | N | false | Flag: recommendedDose a atteint la limite MAX_SINGLE_BOLUS (25.0 U) |
| warnings | String[] | N | {} | Array de warnings (ex: ["isCapped", "noGlucoseMeasure", "hypoTreatmentRequired"]) |
| deliveryMethod | VarChar(20) | N | — | Mode livraison (pump, manual) |
| extendedImmediatePct | Decimal(5,2) | Y | — | % immédiat si extended bolus (ex: 50) |
| extendedDurationHours | Decimal(4,2) | Y | — | Durée extended bolus (h, ex: 2.0) |

**Indexes**:
- `INDEX(patientId, calculatedAt)` — requêtes historique patient

**Immuabilité**:
- CREATE only, jamais UPDATE/DELETE
- Trigger PostgreSQL empêche modifications
- Audit loggé dans `AuditLog` avec action=BOLUS_CALCULATED

**Formules**:
```
mealBolus = inputCarbsGrams / icrUsed
rawCorrectionDose = max(0, (inputGlucoseGl - targetGlucoseMgdl_in_gl) / isfUsedGl)
iobAdjustment = considerIob ? calculateIOB(...) : 0  // TBD
correctionDose = max(0, rawCorrectionDose - iobAdjustment)
recommendedDose = min(mealBolus + correctionDose, MAX_SINGLE_BOLUS)
```

---

### Table: AdjustmentProposal

Propositions d'ajustement de paramètres (basal, ISF, ICR).

**SQL name**: `adjustment_proposals`

**Description**: **CRITIQUE** — IA propose des ajustements (basal trop bas, ICR trop haut, etc.). Médecin doit explicitement accepter/rejeter. Jamais appliqué auto.

**Relations**:
- N:1 → `Patient`
- N:1 → `User` (via `reviewedBy`, FK non-enforced vers reviewer)
- N:1 → `PumpBasalSlot` (si adjustment = basal slot spécifique)

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| parameterType | AdjustableParameter | N | — | Type param: basalRate, insulinSensitivityFactor, insulinToCarbRatio |
| currentValue | Decimal(8,4) | N | — | Valeur actuelle (ex: 0.50 U/h pour basal) |
| proposedValue | Decimal(8,4) | N | — | Valeur proposée (ex: 0.65 U/h) |
| changePercent | Decimal(5,2) | N | — | % changement (ex: +30.0) |
| confidence | ConfidenceLevel | N | — | Confiance: low, medium, high |
| reason | AdjustmentReason | N | — | Raison: basalTooLow, isfTooHigh, etc. |
| supportingEvents | Int | N | — | Nombre d'événements pertinents observés |
| totalEventsConsidered | Int | Y | — | Total événements analysés (filtrés + exclus) |
| excludedEvents | Int | Y | — | Événements exclus (ex: lors maladie, sport) |
| averageObservedValue | Decimal(8,4) | Y | — | Valeur moyenne observée sur période (ex: basal moyen calculé) |
| timeSlotStartHour | SmallInt | Y | — | Heure début si slot horaire (0-23) |
| timeSlotEndHour | SmallInt | Y | — | Heure fin si slot horaire |
| carbRatioSlotStart | SmallInt | Y | — | Slot ICR début si applicable |
| carbRatioSlotEnd | SmallInt | Y | — | Slot ICR fin si applicable |
| pumpBasalSlotId | String (UUID) | Y | — | FK → `PumpBasalSlot.id` si proposal concerne ce slot |
| analysisPeriod | VarChar(10) | Y | — | Période analyse (ex: "7d", "30d") |
| dataQuality | VarChar(20) | Y | — | Qualité données: "good", "fair", "poor" |
| status | ProposalStatus | N | pending | État: pending, accepted, rejected, expired |
| reviewedAt | Timestamptz | Y | — | Date revue par médecin |
| reviewedBy | Int | Y | — | FK → `User.id` (médecin revieweur, NULL si pas encore revue) |
| createdAt | Timestamptz | N | now() | Date création proposition |

**Indexes**:
- `INDEX(patientId, status, createdAt)` — requêtes filtrées

**Lifecycle**:
1. IA crée proposition (status=pending)
2. Médecin la revoit (status=accepted/rejected)
3. Si accepted: médecin clique "apply" → crée nouvel ISF/CarbRatio/BasalSlot avec auditLog
4. Si non revue après 30j → status=expired

**Règles métier**:
- Création auto par worker/cron (non exposée en API actuellement)
- Revue manuelle obligatoire (jamais d'auto-apply)
- Audit: chaque changement de status tracé

---

## Domaine 4 — Données de Glycémie & CGM

Gère les mesures glycémiques: capteurs continus (CGM), ponctuelles (capillaires), événements multi-types.

### Table: CgmEntry

Entrées capteur continu (très haut volume).

**SQL name**: `cgm_entries`

**Description**: **VOLUME CRITIQUE** — ~288 entrées/jour/patient = ~105k/an/patient. Table partitionnée par mois en production (voir `prisma/sql/cgm_partitioning.sql`).

**Relations**:
- N:1 → `Patient`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | BigInt | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| valueGl | Decimal(6,4) | N | — | Glycémie en g/L (ex: 1.30 = 130 mg/dL) |
| timestamp | Timestamptz | N | — | Timestamp mesure (ex: 2026-04-01T10:30:00Z) |
| isManual | Boolean | N | false | Flag: Mesure manuelle (vs automatique CGM) |
| deviceId | VarChar(50) | Y | — | ID appareil (ex: "FreeStyle_ABC123") |
| createdAt | Timestamptz | N | now() | Date insertion en DB |

**Indexes**:
- `INDEX(patientId, timestamp)` — requêtes période + patient
- `INDEX(timestamp)` — requêtes globales par heure

**Partitioning** (PostgreSQL):
- Partitionnée par mois: cgm_entries_2026_01, cgm_entries_2026_02, etc.
- Script: `prisma/sql/cgm_partitioning.sql`
- Avantage: purge mois = DROP PARTITION rapide, requêtes optimisées

**Purge RGPD**:
- Soft delete patient: données CGM restent (anonymisées par trigger)
- Durée conservation: tyiquement 10 ans pour audit

---

### Table: GlycemiaEntry

Mesures ponctuelles (glycémie capillaire, poids, tension, HbA1c).

**SQL name**: `glycemia_entries`

**Description**: Journal des mesures saisies manuellement par patient ou soignant (pas de CGM). Peut contenir repas, bolus, et vitaux.

**Relations**:
- N:1 → `Patient`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| date | Date | N | — | Date mesure (ex: 2026-04-01) |
| time | Time | Y | — | Heure mesure (ex: 10:30:00) |
| isProfessional | Boolean | N | false | Flag: Saisi par pro (vs patient) |
| glycemiaGl | Decimal(6,4) | Y | — | Glycémie (g/L, ex: 1.30) |
| glycemiaMgdl | Decimal(6,2) | Y | — | Glycémie (mg/dL, ex: 130.0) |
| weight | Decimal(5,2) | Y | — | Poids (kg, ex: 75.50) |
| hba1c | Decimal(5,2) | Y | — | HbA1c (%, ex: 6.50) |
| ketones | Decimal(5,2) | Y | — | Cétones (mmol/L, ex: 0.30) |
| bpSystolic | SmallInt | Y | — | Tension systolique (mmHg, ex: 130) |
| bpDiastolic | SmallInt | Y | — | Tension diastolique (mmHg, ex: 80) |
| bolus | Decimal(5,2) | Y | — | Bolus injecté (U, ex: 4.50) |
| bolusCorr | Decimal(5,2) | Y | — | Bolus correction (U, ex: 1.20) |
| basal | Decimal(5,2) | Y | — | Basal sur période (U) |
| insulinDevice | Int | Y | — | ID appareil injection |
| carb | Int | Y | — | Glucides repas (g, ex: 45) |
| mealDescription | String | Y | — | Description repas (ex: "Pâtes bolognaise") |
| mealFullStarchy | Boolean | Y | — | Flag: Repas riche en féculents |
| mealProtein | Boolean | Y | — | Flag: Repas riche en protéines |
| createdAt | Timestamptz | N | now() | Date insertion |

**Indexes**:
- `INDEX(patientId, date, time)` — requêtes journal patient période

---

### Table: DiabetesEvent

Événements multi-type saisis par patient (glycémie, repas, activité, contexte).

**SQL name**: `diabetes_events`

**Description**: Format flexible pour capturer événements complexes. Un événement peut être glycémie + repas + exercice simultanément (eventTypes = tableau).

**Relations**:
- N:1 → `Patient`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| eventDate | Timestamptz | N | — | Timestamp événement |
| eventTypes | DiabetesEventType[] | N | — | **ARRAY d'enums** — types événement (ex: [glycemia, insulinMeal, physicalActivity]) |
| glycemiaValue | Decimal(6,2) | Y | — | Glycémie (mg/dL, si eventTypes inclut glycemia) |
| carbohydrates | Decimal(6,2) | Y | — | Glucides (g, si insulinMeal) |
| bolusDose | Decimal(5,2) | Y | — | Bolus injecté (U, si insulinMeal) |
| basalDose | Decimal(5,2) | Y | — | Basal ajustement (U) |
| activityType | VarChar(20) | Y | — | Type activité (ex: "marche", "course", "sport") si physicalActivity |
| activityDuration | Int | Y | — | Durée activité (minutes) |
| contextType | VarChar(20) | Y | — | Type contexte (ex: "stress", "maladie", "règles", "voyage") si context |
| weight | Decimal(5,2) | Y | — | Poids corporel (kg) |
| hba1c | Decimal(5,2) | Y | — | HbA1c (%) |
| ketones | Decimal(5,2) | Y | — | Cétones (mmol/L) |
| systolicPressure | SmallInt | Y | — | Tension systolique (mmHg) |
| diastolicPressure | SmallInt | Y | — | Tension diastolique (mmHg) |
| comment | String | Y | — | Note libre (ex: "Hypo ressentie") |
| createdAt | Timestamptz | N | now() | Date création |
| updatedAt | Timestamptz | N | now() | Date modification |

**Indexes**:
- `INDEX(patientId, eventDate)` — requêtes période patient

**Important**:
- `eventTypes` est un **ARRAY d'enums** (Prisma 5+, PostgreSQL enum array)
- Permet: `eventTypes = ["glycemia", "insulinMeal"]` → glycémie + repas simultanés
- Requête: `WHERE 'glycemia' = ANY(eventTypes)` en SQL

---

### Table: InsulinFlowEntry

Flux insuline journalier (sommaire et détail horaire).

**SQL name**: `insulin_flow_entries`

**Description**: Résumé insuline du jour (total et par heure). Peut être import de pompe ou saisie manuelle.

**Relations**:
- N:1 → `Patient`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| date | Date | N | — | Date du jour (ex: 2026-04-01) |
| flow | Decimal(6,2) | Y | — | Total insuline jour (U, ex: 35.5) |
| hour | Json | Y | — | Tableau 24h: [0.0, 1.2, 0.8, ..., 1.5] (U par heure) |
| createdAt | Timestamptz | N | now() | Date insertion |

**Format `hour` JSON**:
```json
[1.2, 1.2, 0.8, 0.8, 0.6, 0.6, 1.5, 2.0, 2.5, 2.0, 1.8, 1.5, 1.2, 1.0, 1.2, 1.5, 2.0, 2.5, 2.0, 1.5, 1.2, 1.0, 0.8, 0.6]
```

---

### Table: InsulinFlowDeviceData

Détail complet flux insuline depuis pompe/appareil.

**SQL name**: `insulin_flow_device_data`

**Description**: Import détaillé d'une pompe: événements basal temporaire, bolus, arrêts, etc.

**Relations**:
- N:1 → `Patient`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| deviceId | VarChar(50) | N | — | Numéro série pompe (ex: "PUMP_ABC123") |
| date | Date | N | — | Date synchronisation |
| flow | Decimal(6,2) | Y | — | Total jour (U) |
| hour | Json | Y | — | Détail horaire (like `InsulinFlowEntry.hour`) |
| events | Json | Y | — | Événements détaillés (basal temp, bolus, etc.) |

**Format `events` JSON**:
```json
[
  {"start": "08:00", "end": "09:30", "type": "basal_temp", "rate": 0.75, "tempRate": 1.5},
  {"start": "10:15", "end": "10:20", "type": "bolus", "amount": 4.5},
  {"start": "14:00", "end": "14:02", "type": "alert", "code": "LOW_RESERVOIR"}
]
```

---

### Table: PumpEvent

Événements pompe bruts (alertes, arrêts, erreurs, syncs).

**SQL name**: `pump_events`

**Description**: Flux événementiel pompe pour diagnostique (batterie faible, blocage, etc.).

**Relations**:
- N:1 → `Patient`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| timestamp | Timestamptz | N | — | Timestamp événement |
| eventType | VarChar(50) | N | — | Type événement (ex: "LOW_BATTERY", "OCCLUSION", "SUSPEND") |
| data | Json | Y | — | Données événement (dépend du type) |
| createdAt | Timestamptz | N | now() | Date insertion |

**Indexes**:
- `INDEX(patientId, timestamp)`

---

### Table: AverageData

Glycémie moyenne par période et moment repas (cache pour dashboard).

**SQL name**: `average_data`

**Description**: Pré-calcul des moyennes glycémie pour éviter calculs répétés. Mise à jour par cron 1x/jour.

**Relations**:
- N:1 → `Patient`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| periodType | VarChar(10) | N | — | Période: "current" (7j), "7d" (7j), "30d" (30j) |
| mealType | VarChar(20) | N | — | Moment: "morning", "noon", "evening", "night", "global" |
| glycemia | Decimal(4,2) | Y | — | Glycémie moyenne (g/L) |
| color | VarChar(10) | Y | — | Couleur indicatrice (ex: "green", "orange", "red") |
| glycemia1h | Decimal(4,2) | Y | — | Glycémie 1h post-repas (g/L) |
| color1h | VarChar(10) | Y | — | Couleur post-repas |
| updatedAt | Timestamptz | N | now() | Date dernière mise à jour |

**Unique constraints**:
- `UNIQUE(patientId, periodType, mealType)` — 1 ligne par (patient, période, moment)

**Maintenance**:
- Cron quotidien 23h: recalcul moyennes 7d et 30d
- Ne jamais exposer directement en API (cache read-only)

---

## Domaine 5 — Événements & Activités

**Couvert par la table `DiabetesEvent` du Domaine 4.**

---

## Domaine 6 — Propositions d'Ajustement

**Voir table `AdjustmentProposal` dans Domaine 3.**

---

## Domaine 7 — Appareils & Synchronisation

Gère les appareils médicaux connectés et les historiques de synchronisation.

### Table: PatientDevice

Appareils médicaux associés à un patient.

**SQL name**: `patient_devices`

**Description**: Registre des appareils (CGM, pompe, glucomètre, etc.) utilisés par le patient. Permet traçabilité du matériel et association au données synchronisées.

**Relations**:
- N:1 → `Patient`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| brand | VarChar(100) | Y | — | Marque (ex: "FreeStyle Libre", "Medtronic", "Dexcom") |
| name | VarChar(100) | Y | — | Nom produit (ex: "FreeStyle Libre 2") |
| model | VarChar(100) | Y | — | Modèle (ex: "A1001A") |
| sn | VarChar(100) | Y | — | Numéro série (ex: "123ABC456") |
| date | Timestamptz | Y | — | Date acquisition/activation |
| type | VarChar(50) | Y | — | Type interne (ex: "cgm_freestyle") |
| category | DeviceCategory | Y | — | Catégorie: glucometer, cgm, insulinPump, insulinPen, healthApp |
| connectionTypes | String[] | N | {} | Array types connexion (ex: ["bluetooth", "nfc", "manual_entry"]) |
| modelIdentifier | VarChar(100) | Y | — | Identifiant modèle API (ex: pour sync) |

---

### Table: DeviceDataSync

Historique de synchronisation données depuis appareil.

**SQL name**: `device_data_sync`

**Description**: Trace chaque synchronisation (date, succès/erreur, séquence). Permet détecter syncs non actualisées.

**Relations**:
- N:1 → `User`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| userId | Int | N | — | FK → `User.id` |
| deviceUid | VarChar(100) | N | — | UID appareil unique (ex: "FS_ABC123_USER") |
| sequenceNum | BigInt | N | 0 | Numéro séquence dernier succès (pour détection pertes) |
| lastSyncDate | Timestamptz | Y | — | Timestamp dernière sync réussie |

**Unique constraints**:
- `UNIQUE(userId, deviceUid)` — 1 suivi par (user, device)

---

## Domaine 8 — Équipe Médicale

Gère l'organisation médicale: structures de santé, membres équipes, affectations patients.

### Table: HealthcareService

Structure de santé (hôpital, cabinet privé, CHU, etc.).

**SQL name**: `healthcare_services`

**Description**: Entité organisationnelle (clinique, hôpital, cabinet). Permet grouper médecins/infirmiers et organiser patientèles.

**Relations**:
- 1:N → `HealthcareMember`
- 1:N → `PatientService`
- 1:N → `PatientReferent`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| name | VarChar(255) | N | — | Nom structure (ex: "CHU Bichat - Diabétologie") |
| establishment | VarChar(255) | Y | — | Établissement parent si applicable (ex: "Assistance Publique") |
| city | VarChar(100) | Y | — | Ville (ex: "Paris") |
| country | Char(2) | Y | — | Code pays ISO (ex: "FR") |
| noVideos | Boolean | N | false | Flag: Pas de contenu vidéo autorisé |
| noFood | Boolean | N | false | Flag: Pas de contenus alimentaires autorisés |
| logo | VarChar(500) | Y | — | URL logo (OVH Object Storage) |

**Unique constraints**:
- `UNIQUE(name, establishment)` — évite doublon (même nom, même établissement = dédupliqué)

---

### Table: HealthcareMember

Membre de l'équipe médicale (lien optionnel vers User si aussi utilisateur backoffice).

**SQL name**: `healthcare_members`

**Description**: Professionnel de santé. Peut être User du backoffice (userId non-null) ou externe (userId null).

**Relations**:
- N:1 → `HealthcareService`
- 1:N → `PatientService`
- 1:N → `PatientReferent`
- 1:N → `MedicalDocument`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| userId | Int | Y | — | FK → `User.id` (UNIQUE, lien optionnel) — si NULL, membre externe ou sans compte |
| name | VarChar(255) | N | — | Nom complet (ex: "Dr Dupont Marie-Claude") |
| serviceId | Int | Y | — | FK → `HealthcareService.id` — service d'affiliation |

**Unique constraints**:
- `UNIQUE(name, serviceId)` — évite doublon par service

---

### Table: PatientService

Adhésion patient à une structure médicale.

**SQL name**: `patient_services`

**Description**: Lie un patient à une structure de santé. Permet le contrôle d'accès (DOCTOR/NURSE de cette structure accèdent au patient).

**Relations**:
- N:1 → `Patient`
- N:1 → `HealthcareService`
- N:1 → `HealthcareMember` (optionnel)

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| serviceId | Int | N | — | FK → `HealthcareService.id` |
| memberId | Int | Y | — | FK → `HealthcareMember.id` (optionnel, secrétaire ou contact) |
| wait | Boolean | N | false | Flag: En attente d'acceptation patient |
| createdAt | Timestamptz | N | now() | Date adhésion |

**Unique constraints**:
- `UNIQUE(patientId, serviceId)` — 1 adhésion par (patient, structure)

**Contrôle d'accès**:
- NURSE/DOCTOR de HealthcareService S accèdent à patient P si ∃ PatientService(patientId=P.id, serviceId=S.id)

---

### Table: PatientReferent

Médecin référent unique par patient.

**SQL name**: `patient_referent`

**Description**: Lien direct patient → son médecin coordinateur (unique). Optionnel (peut être NULL).

**Relations**:
- 1:1 → `Patient`
- N:1 → `HealthcareMember` (via `proId`)
- N:1 → `HealthcareService` (via `serviceId`)

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` (UNIQUE 1:1) |
| proId | Int | Y | — | FK → `HealthcareMember.id` — le médecin référent |
| serviceId | Int | Y | — | FK → `HealthcareService.id` — structure du référent |

---

## Domaine 9 — Documents & Rendez-vous

Gère les documents médicaux et l'agenda de rendez-vous.

### Table: MedicalDocument

Documents médicaux (ordonnances, résultats labo, etc.).

**SQL name**: `medical_documents`

**Description**: Partage de documents entre soignants et patients. Stockés sur OVH Object Storage, jamais sur disque local.

**Relations**:
- N:1 → `Patient`
- N:1 → `HealthcareMember` (optionnel)

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| title | VarChar(255) | N | — | Titre document (ex: "Ordonnance insuline 2026-04") |
| date | Timestamptz | N | — | Date document (ex: date ordonnance) |
| memberId | Int | Y | — | FK → `HealthcareMember.id` — auteur si pro |
| patientShare | Boolean | N | true | Flag: Document visible au patient |
| isAuthorPsad | Boolean | N | false | Flag: Auteur est PSAD (Plateforme Sécurisée d'Accès aux Données) |
| shareWithPsad | Boolean | N | false | Flag: Partagé avec PSAD |
| category | DocumentCategory | Y | — | Catégorie: general, forDoctor, personal, prescription, labResults, other |
| mimeType | VarChar(100) | N | application/pdf | Type MIME (ex: "application/pdf", "image/jpeg") |
| fileUrl | VarChar(500) | Y | — | URL fichier OVH Object Storage (ex: "https://s3.ovh.net/.../doc_123.pdf") |
| fileSize | BigInt | Y | — | Taille fichier (bytes) |
| isDownloaded | Boolean | N | false | Flag: Patient a téléchargé |
| isRead | Boolean | N | false | Flag: Patient a consulté |
| createdAt | Timestamptz | N | now() | Date upload |

**Storage**:
- Fichiers jamais en base (stockés OVH S3)
- Suppression fichier = DELETE en OVH + UPDATE fileUrl=NULL
- Audit: chaque accès loggé

---

### Table: Appointment

Rendez-vous médicaux planifiés.

**SQL name**: `appointments`

**Description**: Agenda consulta tions (ide, diabétologue, hospitalisation, etc.).

**Relations**:
- N:1 → `Patient`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| patientId | Int | N | — | FK → `Patient.id` |
| type | VarChar(50) | Y | — | Type RDV (ex: "ide", "diabeto", "hdj", "cardio") |
| date | Date | N | — | Date RDV (ex: 2026-04-15) |
| hour | Time | Y | — | Heure RDV (ex: 14:30:00) |
| comment | String | Y | — | Notes (ex: "Apporter carnet mesures, jeûne depuis 22h") |
| createdAt | Timestamptz | N | now() | Date création RDV |
| updatedAt | Timestamptz | N | now() | Date modification |

---

### Table: Announcement

Annonces système (maintenances, infos, alertes).

**SQL name**: `announcements`

**Description**: Messages adressés à tous les utilisateurs. Affiché en banneau avec callback optionnel.

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| title | VarChar(255) | N | — | Titre annonce (ex: "Maintenance prévue 15/04") |
| content | String | N | — | Contenu HTML |
| callBackDelay | Int | Y | — | Délai avant ré-affichage (jours) si dismissed par user |
| displayAnnouncement | Boolean | N | true | Flag: Afficher annonce |
| displayShowButton | Boolean | N | true | Flag: Afficher bouton "Détails" |
| createdAt | Timestamptz | N | now() | Date création |
| updatedAt | Timestamptz | N | now() | Date modification |

---

## Domaine 10 — Notifications Push

Gère les notifications push (FCM, Apple Push, Web).

### Table: PushDeviceRegistration

Inscription appareil pour notifications push.

**SQL name**: `push_device_registrations`

**Description**: Chaque device (téléphone, web) enregistre un token FCM pour recevoir des notifications. Permet ciblage par platform/langue.

**Relations**:
- N:1 → `User`
- 1:N → `PushNotificationLog`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| userId | Int | N | — | FK → `User.id` |
| platform | PushPlatform | N | — | Platform: ios, android, web |
| pushToken | VarChar(500) | N | — | Token FCM/APNs unique (UNIQUE) |
| deviceName | VarChar(100) | Y | — | Nom device (ex: "iPhone de Marie") |
| deviceModel | VarChar(50) | Y | — | Modèle (ex: "iPhone13,3") |
| osVersion | VarChar(20) | Y | — | Version OS (ex: "17.4.1") |
| appVersion | VarChar(20) | Y | — | Version app (ex: "2.3.1") |
| appBundleId | VarChar(100) | Y | — | Bundle ID app (ex: "com.diabeo.backoffice") |
| endpointArn | VarChar(500) | Y | — | ARN endpoint AWS SNS (si utilisé) |
| locale | VarChar(10) | N | fr | Locale device (ex: "fr_FR") |
| pushTimezone | VarChar(50) | Y | — | Timezone device (ex: "Europe/Paris") |
| isActive | Boolean | N | true | Flag: Token actif (pas désabonné) |
| isSandbox | Boolean | N | false | Flag: Token sandbox (Apple dev) |
| lastUsedAt | Timestamptz | Y | — | Dernière notification envoyée |
| registeredAt | Timestamptz | N | now() | Date enregistrement |
| updatedAt | Timestamptz | N | now() | Date modification |
| unregisteredAt | Timestamptz | Y | — | Date désinscription (isActive=false) |

**Indexes**:
- `INDEX(userId, isActive)` — requêtes users actifs
- `INDEX(platform, isActive)` — envoi par platform

**Lifecycle**:
- Création: app enregistre token → POST /api/push/register
- Suppression: user se désabonne → SET unregisteredAt=NOW(), isActive=false
- Expiration: token invalid après 30j d'inactivité → SET isActive=false (cron)

---

### Table: PushNotificationTemplate

Modèles de notifications (multilingues, multiplateforme).

**SQL name**: `push_notification_templates`

**Description**: Gabarits pour notifications. Peut inclure variables `{patientName}`, `{glucoseValue}`, etc. Supports i18n (fr/en/ar) et paramètres plateforme.

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | VarChar(50) | N | — | ID template (ex: "hypo_alert", "appointment_reminder") (PK) |
| category | VarChar(30) | N | — | Catégorie (ex: "clinical_alert", "reminder", "system") |
| titleFr | VarChar(200) | N | — | Titre en français |
| titleEn | VarChar(200) | N | — | Titre en anglais |
| titleAr | VarChar(200) | N | — | Titre en arabe |
| bodyFr | String | N | — | Corps message français (peut inclure variables) |
| bodyEn | String | N | — | Corps message anglais |
| bodyAr | String | N | — | Corps message arabe |
| iosSound | VarChar(50) | Y | default | Son iOS (ex: "default", "alarm", "notification") |
| iosBadgeIncrement | Int | Y | 1 | Incrément badge app iOS (+1, +0, etc.) |
| iosCategory | VarChar(50) | Y | — | Catégorie action iOS (ex: "GLYCEMIA_ALERT") |
| iosInterruptionLevel | IosInterruptionLevel | Y | active | Niveau interruption iOS (passive/active/time_sensitive/critical) |
| androidChannelId | VarChar(50) | Y | — | ID canal Android (ex: "diabeo_clinical") |
| androidPriority | AndroidPriority | Y | high | Priorité Android (normal/high) |
| androidIcon | VarChar(50) | Y | — | Icon Android (ex: "ic_notification") |
| dataPayload | Json | Y | — | Données supplémentaires (ex: `{"deep_link": "/patient/123/cgm"}`) |
| ttlSeconds | Int | Y | 86400 | TTL notification (secondes, défaut 1 jour) |
| isActive | Boolean | N | true | Flag: Template actif |
| createdAt | Timestamptz | N | now() | Date création |
| updatedAt | Timestamptz | N | now() | Date modification |

**Indexes**:
- `INDEX(category)` — requêtes par type

**Variables support**:
```
{userName}: John
{patientName}: Marie Dupont
{glucoseValue}: 65
{glucoseUnit}: mg/dL
{appointment}: Vendredi 14/04 14h30 - Dr Durand
```

---

### Table: PushNotificationLog

Journal immuable d'envoi de notifications.

**SQL name**: `push_notifications_log`

**Description**: Trace chaque notification envoyée: état (pending/sent/delivered/failed), timestamp, erreurs. Non modifiable après création.

**Relations**:
- N:1 → `User`
- N:1 → `PushDeviceRegistration` (optionnel)
- N:1 → `PushNotificationTemplate` (optionnel)

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| userId | Int | N | — | FK → `User.id` |
| registrationId | VarChar(50) | Y | — | FK → `PushDeviceRegistration.id` (peut être dénormalisé) |
| templateId | VarChar(50) | Y | — | FK → `PushNotificationTemplate.id` |
| platform | PushPlatform | N | — | Platform ciblée: ios, android, web |
| title | VarChar(200) | N | — | Titre effectif envoyé (après substitution variables) |
| body | String | N | — | Corps effectif envoyé |
| dataPayload | Json | Y | — | Données supplémentaires envoyées |
| status | PushNotifStatus | N | pending | État: pending, sent, delivered, failed, expired |
| providerMessageId | VarChar(200) | Y | — | ID message du provider FCM/APNs (pour tracking) |
| errorCode | VarChar(50) | Y | — | Code erreur si failed (ex: "INVALID_TOKEN", "MESSAGE_RATE_EXCEEDED") |
| errorMessage | String | Y | — | Message erreur détaillé |
| sentAt | Timestamptz | Y | — | Timestamp envoi au provider |
| deliveredAt | Timestamptz | Y | — | Timestamp livraison confirmée |
| openedAt | Timestamptz | Y | — | Timestamp ouverture par user (si trackable) |
| createdAt | Timestamptz | N | now() | Date création log |

**Indexes**:
- `INDEX(userId)` — requêtes notifications d'un user
- `INDEX(status)` — requêtes notifications non livrées
- `INDEX(createdAt)` — requêtes par période
- `INDEX(templateId, status)` — requêtes efficacité template

**Immuabilité**:
- CREATE only, jamais UPDATE/DELETE
- Audit: action=PUSH_NOTIFICATION_SENT

---

### Table: PushScheduledNotification

Notifications programmées (cron, emails rappels réguliers).

**SQL name**: `push_scheduled_notifications`

**Description**: Notifications récurrentes (rappel glycémie chaque matin à 07:00, ou alerte HbA1c mensuelle). Gérées par worker/cron.

**Relations**:
- N:1 → `User`
- N:1 → `PushNotificationTemplate`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| userId | Int | N | — | FK → `User.id` |
| templateId | VarChar(50) | N | — | FK → `PushNotificationTemplate.id` |
| scheduleType | ScheduleType | N | — | Type: once, daily, weekly, custom_cron |
| scheduledAt | Timestamptz | Y | — | Timestamp premier envoi si once |
| cronExpression | VarChar(50) | Y | — | Expression CRON si custom_cron (ex: "0 7 * * *" = 7h chaque jour) |
| cronTimezone | VarChar(50) | N | Europe/Paris | Timezone CRON (ex: "Europe/London") |
| templateVariables | Json | Y | — | Variables pour substitution (ex: `{"glucoseUnit": "mg/dL"}`) |
| platforms | PushPlatform[] | N | [ios, android, web] | Platforms ciblées |
| isActive | Boolean | N | true | Flag: Notification active |
| lastTriggeredAt | Timestamptz | Y | — | Timestamp dernier envoi effectué |
| nextTriggerAt | Timestamptz | Y | — | Timestamp prochain envoi prévu |
| maxOccurrences | Int | Y | — | Nombre max d'envois (NULL = infini) |
| occurrencesCount | Int | N | 0 | Nombre d'envois déjà faits |
| expiresAt | Timestamptz | Y | — | Date expiration (après: isActive=false auto) |
| createdAt | Timestamptz | N | now() | Date création |
| updatedAt | Timestamptz | N | now() | Date modification |

**Indexes**:
- `INDEX(userId)` — requêtes notifications user
- `INDEX(nextTriggerAt, isActive)` — requêtes worker (quoi déclencher maintenant?)

**Lifecycle**:
1. User crée rappel "glycémie chaque matin 07:00"
2. System crée row: scheduleType=daily, cronExpression=null, nextTriggerAt=demain 07:00 Europe/Paris
3. Cron worker: requête `WHERE nextTriggerAt <= NOW() AND isActive=true`
4. Pour chaque ligne: envoie notification, SET lastTriggeredAt=NOW(), recalcule nextTriggerAt
5. Si occurrencesCount >= maxOccurrences: SET isActive=false

---

## Domaine 11 — Configuration & UI

Gère les configurations utilisateur: unités de mesure, layout dashboard, moments du jour, états UI.

### Table: DashboardConfiguration

Configuration du dashboard personnalisé.

**SQL name**: `dashboard_configurations`

**Description**: Layout grille du dashboard de chaque user. Permet sauvegarder colonnes, widgets, ordre.

**Relations**:
- 1:1 → `User`
- 1:N → `DashboardWidget`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| userId | Int | N | — | FK → `User.id` (UNIQUE 1:1) |
| version | Int | N | 1 | Version configuration (pour rollback) |
| columnCount | Int | N | 4 | Nombre colonnes grille (ex: 4, 6, 12) |
| name | VarChar(100) | Y | — | Nom configuration (ex: "Suivi quotidien", "Vue complète") |
| lastModified | Timestamptz | N | now() | Date dernier changement layout |

---

### Table: DashboardWidget

Widget du dashboard (position, visibilité, dimensions).

**SQL name**: `dashboard_widgets`

**Description**: Chaque widget: glycémie moyenne, graphe CGM, événements récents, etc. Positionnement grille CSS.

**Relations**:
- N:1 → `DashboardConfiguration`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| configId | Int | N | — | FK → `DashboardConfiguration.id` |
| type | VarChar(30) | N | — | Type widget (ex: "cgm_chart", "glucose_average", "recent_events", "insulin_summary") |
| positionRow | Int | N | — | Position ligne grille (0-based, ex: 0) |
| positionColumn | Int | N | — | Position colonne grille (0-based, ex: 0) |
| spanColumns | Int | N | 1 | Nombre colonnes occupées (ex: 2 = demi-largeur) |
| spanRows | Int | N | 1 | Nombre lignes occupées (ex: 2) |
| isVisible | Boolean | N | true | Flag: Widget affiché |
| customTitle | VarChar(100) | Y | — | Titre personnalisé (override défaut) |

---

### Table: UnitDefinition

Référentiel des unités de mesure supportées.

**SQL name**: `unit_definitions`

**Description**: Matrice de conversion: glucose (mg/dL, g/L, mmol/L), poids (kg, lbs), HbA1c (%, mmol/mol), etc.

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| category | VarChar(30) | N | — | Catégorie (ex: "glucose", "weight", "hba1c") |
| unitCode | Int | N | — | Code numérique (UNIQUE) — utilisé dans `UserUnitPreferences` |
| unit | VarChar(20) | N | — | Symbole (ex: "mg/dL", "g/L", "mmol/L") |
| title | VarChar(50) | N | — | Titre lisible (ex: "Milligrammes par décilitre") |
| factor | Decimal(10,6) | Y | — | Facteur de conversion (ex: 18.01559 pour mg/dL → mmol/L) |
| factorBase | Decimal(10,6) | Y | — | Base de conversion (ex: 18.01559 = 1 mmol/L = 18 mg/dL) |
| precision | Int | Y | — | Nombre décimales affichées (ex: 2 pour "120.50 mg/dL") |

**Seed data** (exemple):
| unitCode | category | unit | title | factor |
|----------|----------|------|-------|--------|
| 3 | glucose | g/L | Grammes par litre | 0.05551 |
| 4 | glucose | mg/dL | Milligrammes par décilitre | 1.0 |
| 5 | glucose | mmol/L | Millimoles par litre | 0.05551 |
| 6 | weight | kg | Kilogramme | 1.0 |
| 7 | weight | lbs | Livre | 2.20462 |

---

### Table: UserDayMoment

**Voir Domaine 1** — table `UserDayMoment`.

---

### Table: UiStateSave

**Voir Domaine 1** — table `UiStateSave`.

---

### Table: BasalFlowSchedule (Configuration Traitements)

Horaire de flux basal pour un traitement.

**SQL name**: `basal_flow_schedules`

**Description**: Supplément à `Treatment`: si traitement basal, définit le débit à chaque heure. Similaire à `PumpBasalSlot` mais pour les traitements génériques (non pompe).

**Relations**:
- N:1 → `Treatment`

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | Int | N | autoincrement | Identifiant unique |
| treatmentId | Int | N | — | FK → `Treatment.id` |
| label | VarChar(50) | Y | — | Label (ex: "Matin", "Midi", "Soir") |
| scheduleStart | Time | N | — | Heure début (ex: "08:00:00") |
| scheduleRate | Decimal(5,3) | N | — | Débit U/h (ex: 0.500) |

---

## Audit Log (Immuable HDS)

Enregistrement immuable de tous les accès/modifications aux données de santé.

### Table: AuditLog

**SQL name**: `audit_logs`

**Description**: **TABLE CRITIQUE HDS** — Trace chaque action: READ, CREATE, UPDATE, DELETE sur données patients. **IMMUABLE** par trigger PostgreSQL (voir `prisma/sql/audit_immutability.sql`). Jamais loggée en plaintext.

**Relations**:
- N:1 → `User` (avec `onDelete: Restrict` — audit ne peut pas être orphelin)

| Colonne | Type | Nullable | Default | Description |
|---------|------|----------|---------|-------------|
| id | String (UUID) | N | uuid() | Identifiant unique |
| userId | Int | N | — | FK → `User.id` (onDelete: Restrict = ne pas laisser orphelins) |
| action | VarChar(30) | N | — | Action: READ, CREATE, UPDATE, DELETE, EXPORT, DOWNLOAD, LOGIN, LOGOUT, BOLUS_CALCULATED, PASSWORD_CHANGED, etc. |
| resource | VarChar(30) | N | — | Ressource: USER, PATIENT, CGM_ENTRY, INSULIN_CONFIG, ADJUSTMENT_PROPOSAL, DOCUMENT, etc. |
| resourceId | String | Y | — | ID ressource (ex: "patient:123", "cgm:456789", "doc:abc") |
| oldValue | Json | Y | — | **JAMAIS de plaintext** — valeur avant update (cryptée ou hash si sensible) |
| newValue | Json | Y | — | **JAMAIS de plaintext** — valeur après update |
| ipAddress | VarChar(45) | Y | — | Adresse IP source (ex: "203.0.113.42", "2001:db8::1") |
| userAgent | VarChar(500) | Y | — | User-Agent client (ex: "Mozilla/5.0...") |
| metadata | Json | N | {} | Métadonnées supplémentaires (ex: `{"reason": "diabetes_mgmt_plan"}`) |
| createdAt | Timestamptz | N | now() | Timestamp action |

**Indexes**:
- `INDEX(userId, createdAt)` — requêtes audit utilisateur
- `INDEX(resource, resourceId, createdAt)` — requêtes audit ressource
- `INDEX(createdAt)` — requêtes par période

**Immuabilité**:
- ✅ Enforced par trigger PostgreSQL: `BEFORE UPDATE/DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_modification()`
- ❌ Jamais UPDATE/DELETE applicatif possible
- Données modifiées: anonymisé directement en DB, audit reste inchangé

**Extraction contexte HTTP**:
```typescript
// Dans API Routes
import { extractRequestContext } from "@/lib/auth"
const { ipAddress, userAgent } = extractRequestContext(req)

await auditService.log({
  userId: session.user.id,
  action: "READ",
  resource: "PATIENT",
  resourceId: `patient:${patientId}`,
  ipAddress,
  userAgent,
  metadata: { patientPathology: "DT1" }
})
```

**Règles métier**:
- **Jamais logger plaintext** après déchiffrement (log=hash ou "***")
- **Jamais logger sensible data** sauf en `metadata` chiffré
- **READ sur patient**: audité à chaque accès
- **CREATE/UPDATE**: oldValue et newValue
- **Durée conservation**: 10 ans (conformité HDS)

**Exemple audit entries**:
```
(id, userId, action, resource, resourceId, ipAddress, userAgent, createdAt)
('001', 42, 'LOGIN', 'USER', 'user:42', '203.0.113.1', 'Mozilla/5.0...', '2026-04-01T08:15:00Z')
('002', 42, 'READ', 'PATIENT', 'patient:123', '203.0.113.1', 'Mozilla/5.0...', '2026-04-01T08:16:30Z')
('003', 42, 'UPDATE', 'INSULIN_CONFIG', 'isf:abc-uuid', '203.0.113.1', 'Mozilla/5.0...', '2026-04-01T08:20:00Z')
  → oldValue: {"sensitivityFactorGl": 0.40}
  → newValue: {"sensitivityFactorGl": 0.45}
('004', 42, 'BOLUS_CALCULATED', 'BOLUS_LOG', 'bolus:xyz', '203.0.113.1', 'Mozilla/5.0...', '2026-04-01T12:30:15Z')
  → metadata: {"warnings": ["isCapped"], "confidenceLevel": "high"}
('005', 42, 'EXPORT', 'PATIENT', 'patient:123', '203.0.113.1', 'Mozilla/5.0...', '2026-04-01T14:00:00Z')
  → metadata: {"format": "json", "dataPoints": 45000}
```

---

## Modèles de données — Résumé des relations

### Diagramme de relations simplifiés

```
User (7 tables)
├─ 1:1 → Patient
│       ├─ N:N ← HealthcareMember (PatientService)
│       ├─ 1:1 → PatientMedicalData
│       ├─ 1:1 → PatientAdministrative
│       ├─ 1:N → PatientPregnancy
│       ├─ 1:1 → InsulinTherapySettings
│       │       ├─ 1:N → GlucoseTarget
│       │       ├─ 1:1 → IobSettings
│       │       ├─ 1:1 → ExtendedBolusSettings
│       │       ├─ 1:N → InsulinSensitivityFactor (24 slots)
│       │       ├─ 1:N → CarbRatio (24 slots)
│       │       └─ 1:1 → BasalConfiguration
│       │           └─ 1:N → PumpBasalSlot (24-96 slots)
│       ├─ 1:N → Treatment
│       │       └─ 1:N → BasalFlowSchedule
│       ├─ 1:N → BolusCalculationLog
│       ├─ 1:N → AdjustmentProposal → ← User.reviewedBy
│       ├─ 1:N → CgmEntry (partitioned)
│       ├─ 1:N → GlycemiaEntry
│       ├─ 1:N → DiabetesEvent
│       ├─ 1:N → InsulinFlowEntry
│       ├─ 1:N → InsulinFlowDeviceData
│       ├─ 1:N → PumpEvent
│       ├─ 1:N → AverageData
│       ├─ 1:N → PatientDevice
│       ├─ 1:1 → PatientReferent ← HealthcareMember
│       ├─ 1:N → PatientService → HealthcareService
│       ├─ 1:N → MedicalDocument
│       └─ 1:N → Appointment
├─ 1:1 → UserUnitPreferences
├─ 1:1 → UserNotifPreferences
├─ 1:1 → UserPrivacySettings
├─ 1:N → UserDayMoment
├─ 1:N → UiStateSave
├─ 1:N → Session
├─ 1:N → Account (OAuth)
├─ 1:N → DeviceDataSync
├─ 1:1 → DashboardConfiguration
│       └─ 1:N → DashboardWidget
├─ 1:N → PushDeviceRegistration
│       └─ 1:N → PushNotificationLog → PushNotificationTemplate
├─ 1:N → PushScheduledNotification → PushNotificationTemplate
└─ 1:N → AuditLog
```

---

## Guide d'utilisation par domaine

### Domaine Authentification & User

**Accès**: Toujours via `auth()` NextAuth v5 → `session.user`

```typescript
import { auth } from "@/lib/auth"

// Dans API route
const session = await auth()
if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

// Accès données user
const userId = session.user.id
const role = session.user.role  // ADMIN, DOCTOR, NURSE, VIEWER
```

### Domaine Patient & Données Médicales

**Contrôle d'accès**:
- ADMIN: tous les patients
- DOCTOR/NURSE: patients de leurs structures (via `PatientService`)
- VIEWER/Patient: propre patient (via `Patient.userId`)

**Chiffrement**:
```typescript
import { encryptField, decryptField } from "@/lib/crypto/health-data"

// Create patient
const firstname = encryptField("Marie")

// Read patient
const user = await getUser(userId)
const decrypted = decryptField(user.firstname)
```

### Domaine Insulinothérapie

**Calcul bolus**:
```typescript
import { insulinTherapyService } from "@/lib/services/insulin-therapy.service"

const result = await insulinTherapyService.calculateBolus({
  patientId,
  glucoseValueGl: 1.30,
  carbsGrams: 45,
  timestamp: new Date(),
}, auditUserId)
// → { recommendedDose, warnings, isCapped, ... }

// JAMAIS auto-injecter, créer AdjustmentProposal et attendre validation médecin
```

### Domaine CGM & Glycémie

**Volumétrie**:
- CgmEntry: ~105k entries/patient/an (5 min résolution)
- Partitionned par mois, index sur (patientId, timestamp)
- Requêtes: toujours avec date range

```typescript
// Requête optimisée
const entries = await prisma.cgmEntry.findMany({
  where: {
    patientId,
    timestamp: {
      gte: new Date("2026-03-01"),
      lte: new Date("2026-04-01"),
    },
  },
  orderBy: { timestamp: "asc" },
})
```

### Domaine Documents

**Stockage**:
- Jamais disque local
- Toujours OVH Object Storage S3
- URL dans `MedicalDocument.fileUrl`

```typescript
// Upload
const s3Url = await uploadToOvhS3(file)
await prisma.medicalDocument.create({
  data: {
    patientId,
    fileUrl: s3Url,
    mimeType: file.type,
  }
})
```

### Domaine Audit

**Obligation**:
- Chaque READ sur données patient
- Chaque CREATE/UPDATE/DELETE

```typescript
await auditService.log({
  userId: session.user.id,
  action: "READ",
  resource: "INSULIN_CONFIG",
  resourceId: `settings:${settingsId}`,
  ipAddress, userAgent,
  metadata: { patientId } // Jamais plaintext sensible
})
```

---

## Conventions de nommage & Bonnes pratiques

| Élément | Convention | Exemple |
|---------|-----------|---------|
| Table SQL | snake_case | `insulin_therapy_settings` |
| Colonnes SQL | snake_case | `patient_id`, `value_gl` |
| Champ Prisma | camelCase | `patientId`, `valueGl` |
| Enum Prisma | PascalCase | `Role`, `Pathology`, `DiabetesEventType` |
| Valeur enum | SCREAMING_SNAKE_CASE | `DOCTOR`, `DT1`, `glycemia` |
| Identifiants | uuid() ou autoincrement() | UUIDs pour données immuables (bolus), autoincrement() pour master data |
| Timestamps | Timestamptz (format ISO) | Always UTC, converted to user timezone in app |
| Valeurs décimales | Decimal(precision, scale) | Decimal(6,4) pour glycémie g/L |
| Softdelete | deletedAt field | Toute requête `WHERE deletedAt IS NULL` |

---

## Checklist sécurité & HDS

- [ ] **Chiffrement**: Tous les champs sensibles (email, NIR, antécédents) chiffrés AES-256-GCM avant INSERT
- [ ] **HMAC**: emailHmac utilisé pour lookups unique sans exposer email
- [ ] **Audit**: Chaque READ/CREATE/UPDATE sur données patients loggé dans AuditLog
- [ ] **Immuabilité**: AuditLog jamais modifiable, enforced par trigger PostgreSQL
- [ ] **Soft delete**: Patients jamais supprimés physiquement, juste marqués deletedAt
- [ ] **Partitioning**: CgmEntry partitionnée par mois en production
- [ ] **OVH Storage**: Tous les fichiers sur Object Storage, jamais disque local
- [ ] **Accès**: Contrôle d'accès par rôle + PatientService
- [ ] **MFA**: Optionnelle mais fortement recommandée pour médecins
- [ ] **Rate limiting**: Sur endpoints critiques (auth, export, calcul bolus)

---

## Glossaire médical

| Terme | Définition | Unité |
|-------|-----------|-------|
| **Glycémie** | Concentration glucose dans le sang | g/L, mg/dL, mmol/L |
| **CGM** | Continuous Glucose Monitoring — capteur glucose continu | — |
| **FGM** | Flash Glucose Monitoring (FreeStyle Libre) | — |
| **ISF** | Insulin Sensitivity Factor — correction par 1 U insuline | g/L/U, mg/dL/U |
| **ICR** | Insulin to Carb Ratio — couvre glucides par 1 U | g/U |
| **IOB** | Insulin On Board — insuline active dans le corps | U |
| **Bolus** | Injection insuline rapide pour repas/correction | U |
| **Basal** | Insuline de fond continue (pompe ou injection) | U/h ou U/jour |
| **TIR** | Time In Range — % temps glycémie dans cible | % |
| **HbA1c** | Hémoglobine glyquée — moyenne 3 mois | %, mmol/mol |
| **ALD** | Affection Longue Durée — statut exonération ticket modérateur | — |
| **NIRPP** | Numéro d'Inscription Répertoire Professionnel/Personne | — |
| **INS** | Identité Nationale de Santé (clé santé) | — |
| **GD** | Diabète Gestationnel (pendant grossesse) | — |
| **DT1** | Diabète Type 1 (auto-immune, insulino-dépendant) | — |
| **DT2** | Diabète Type 2 (métabolique, évolution progressive) | — |

---

## Ressources & Références

- **Prisma Documentation**: https://www.prisma.io/docs/
- **PostgreSQL 16 Types**: https://www.postgresql.org/docs/16/datatype.html
- **NextAuth v5**: https://authjs.dev/
- **HDS/RGPD Compliance**: ANSSI recommendations, CNIL guidelines
- **CLAUDE.md**: Architecture globale, décisions architecturales (ADR)
- **SQL Scripts**: `prisma/sql/` pour partitioning, triggers, constraints

---

**Document généré**: 2026-04-01 — Phase 0 implémentée  
**Statut**: ✅ Schéma complet (50 tables, 22 enums)  
**Prochaine mise à jour**: Après phases 3-7 (API CRUD complète)
