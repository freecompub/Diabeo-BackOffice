# US-2235 — Mode voyage / fuseau horaire

> 📌 **25. Gestion modes contextuels (grossesse / pédiatrie / Ramadan / voyage)** · Priorité **V1**
> 🪞 **Miroir backoffice** d'une fonctionnalité de l'app patient

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2235` |
| **Domaine** | 25. Gestion modes contextuels (grossesse / pédiatrie / Ramadan / voyage) |
| **Type** | Miroir backoffice (configuration / supervision / orchestration côté médecin) |
| **Priorité** | **V1** |
| **Pays cible** | Universel |
| **Intégration externe** | Non (purement backend Diabeo) |
| **Story points** | **3** (Fibonacci) |
| **Statut** | 🆕 À démarrer |
| **Dépendances** | US-2001 (Login JWT), US-2011 (Audit log immuable), US-2012 (RBAC 4 rôles), US-2018 (Fiche patient), Miroir app patient : US-3255 (mode voyage patient) |
| **Sprint cible** | À définir |

---

## 📋 Contexte métier

### Pourquoi cette US existe ?

Activation préventive du mode voyage : saisie destination, durée, génération automatique d'un protocole d'adaptation des doses sur le décalage horaire.

### Lien avec l'app patient

Cette US est le **pendant côté professionnel** d'une (ou plusieurs) fonctionnalité(s) de l'app patient. Elle permet au médecin/équipe soignante de **configurer, superviser ou orchestrer** ce qui se passe côté patient — sans quoi l'app patient serait un système autonome non maîtrisé par l'équipe soignante.

**US miroir patient** : US-3255 (mode voyage patient)

### Archétype : config

Cette US couvre la **configuration médicale** d'un paramètre patient. L'enjeu principal est la traçabilité (qui a configuré quoi, quand, pourquoi) et la validation (RBAC strict, validation médicale obligatoire, audit immuable).

### Personas concernés

- **DOCTOR** (rôle principal) : configuration médicale, supervision clinique, validation des workflows
- **NURSE** : peut souvent consulter et préparer les configurations, mais validation finale par le DOCTOR
- **ADMIN** cabinet : configurations transverses, audit, gestion utilisateurs
- **VIEWER** : lecture seule sur les vues de supervision (selon politique cabinet)

### Valeur produit

- **Pour le médecin** : maîtrise clinique sur ce que voit/fait le patient, sécurité renforcée
- **Pour le patient** : sécurité accrue (paramètres validés médicalement), continuité du suivi
- **Pour le cabinet** : conformité (audit complet), productivité (workflows automatisés)
- **Pour le système de santé** : meilleur équilibre patient → réduction urgences/hospitalisations

---

## ✅ Critères d'acceptation

### AC-1 — RBAC respecté

```gherkin
Étant donné Un utilisateur authentifié avec un rôle insuffisant
Quand il tente d'accéder à « Mode voyage / fuseau horaire »
Alors la requête est rejetée HTTP 403 et journalisée
```

### AC-2 — Audit log enregistré

```gherkin
Étant donné Une action sur « Mode voyage / fuseau horaire » est effectuée
Quand elle est exécutée avec succès
Alors un AuditLog est créé (action, resource, resourceId, userId, ip, ua, metadata)
```

### AC-3 — Versionnement de la configuration

```gherkin
Étant donné Une configuration patient est modifiée
Quand le changement est sauvegardé
Alors une nouvelle version de la configuration est créée, l'ancienne reste consultable
```

### AC-4 — Validation médicale obligatoire

```gherkin
Étant donné Une modification est apportée par un rôle NURSE
Quand elle requiert validation
Alors elle reste en statut PENDING_VALIDATION jusqu'à approbation par un DOCTOR
```

### AC-5 — Synchronisation app patient

```gherkin
Étant donné Une nouvelle configuration est validée
Quand elle est appliquée côté backend
Alors l'app patient reçoit la mise à jour à la prochaine sync (push notification + pull)
```


---

## 📐 Règles métier

- **RM-1 : Toute action sur cette fonctionnalité est journalisée dans AuditLog (action, resource, resourceId, userId, ip, userAgent).**
- **RM-2 : RBAC strict : seuls les rôles autorisés (DOCTOR au minimum sauf cas particuliers) peuvent accéder.**
- **RM-3 : Le médecin ne voit que les patients de son portefeuille (vérification `referentId` ou délégation explicite).**
- **RM-4 : Données de santé manipulées chiffrées AES-256-GCM (cohérent backoffice).**
- **RM-5 : Schémas Zod sur tous les inputs API.**
- **RM-6 : Toute modification de configuration patient crée une nouvelle version (table avec `validFrom`/`validTo`).**
- **RM-7 : Si la modification impacte la sécurité du patient (cibles glycémiques, seuils urgence), validation médicale obligatoire.**
- **RM-8 : Notification automatique au patient (app) lors d'une modification le concernant, avec consentement préalable explicite.**

---

## 🗄️ Modèle de données

Cette US **réutilise les modèles Prisma existants** du backoffice (48 tables) et peut nécessiter des extensions pour :

```prisma
// Extensions probables selon l'archétype "config"
// Versionnement des configurations patient
model PatientConfigVersion {
  id            String   @id @default(cuid())
  patientId     String
  configType    String   // "GLUCOSE_TARGETS" | "ALERT_THRESHOLDS" | "EMERGENCY_PROTOCOL" etc.
  version       Int
  configJson    Json     // Configuration complète à ce point dans le temps
  validFrom     DateTime @default(now())
  validTo       DateTime?
  createdById   String
  validatedById String?  // DOCTOR qui a validé (si NURSE a créé)
  validatedAt   DateTime?

  patient       Patient @relation(fields: [patientId], references: [id])
  createdBy     User    @relation("CreatedConfig", fields: [createdById], references: [id])
  validatedBy   User?   @relation("ValidatedConfig", fields: [validatedById], references: [id])

  @@index([patientId, configType, validFrom])
  @@unique([patientId, configType, version])
}
```

> Le schéma précis sera affiné lors du design technique du sprint, en cohérence avec les 48 tables existantes.

---

## 🔌 API & contrats

### Endpoints exposés (indicatifs)

```
GET    /api/patients/[patientId]/mode-voyage-fuseau-horaire                    Lecture configuration courante
PUT    /api/patients/[patientId]/mode-voyage-fuseau-horaire                    Création nouvelle version
POST   /api/patients/[patientId]/mode-voyage-fuseau-horaire/validate           Validation par DOCTOR si créée par NURSE
GET    /api/patients/[patientId]/mode-voyage-fuseau-horaire/history            Historique versions
POST   /api/patients/[patientId]/mode-voyage-fuseau-horaire/restore/[versionId]   Restauration d'une version antérieure
```

### Authentification
- JWT RS256 obligatoire
- Header `Authorization: Bearer <token>`

### Validation Zod
Schémas Zod stricts sur tous les inputs. Voir `src/lib/services/mode-voyage-fuseau-horaire.service.ts`.

---

## ⚠️ Scénarios d'erreur

| HTTP | Code applicatif | Message | Comportement |
|------|-----------------|---------|--------------|
| 400 | `VALIDATION_ERROR` | Détails sur champs invalides | Renvoie schéma d'erreur Zod |
| 401 | `UNAUTHENTICATED` | Veuillez vous connecter | Redirect login |
| 403 | `FORBIDDEN` | Permissions insuffisantes | Message générique, log la tentative |
| 404 | `NOT_FOUND` | Ressource introuvable | Sans détail révélateur |
| 409 | `CONFLICT` | Conflit d'état | Détail métier si non sensible |
| 422 | `BUSINESS_RULE` | Règle métier violée | Détail de la règle |
| 429 | `RATE_LIMITED` | Trop de requêtes | Retry-After |
| 500 | `INTERNAL_ERROR` | Erreur interne | Sentry + ID corrélation |

---

## 🔒 Sécurité & conformité HDS

### Authentification & RBAC
- JWT RS256 (jose), durée access 15 min / refresh 7j
- RBAC : DOCTOR au minimum sauf cas spécifiques (ADMIN pour audit, NURSE pour création préparée)
- Middleware `requireRole(['DOCTOR', 'ADMIN'])` selon endpoint

### Périmètre patients
Vérification stricte que le médecin n'accède qu'aux patients de son portefeuille (`patient.referentId == user.id` ou délégation explicite via `HealthcareMember`).

### Chiffrement
- Champs sensibles AES-256-GCM (cohérent backoffice)
- Pas de valeur déchiffrée dans logs ni metadata AuditLog

### Audit
- Toute opération journalisée dans AuditLog immuable
- Resource = nom de la fonctionnalité (ex: `PATIENT_CONFIG_THRESHOLDS`)
- ResourceId = patientId ou ID de la configuration
- Metadata = contexte non sensible (ex: ancien seuil → nouveau seuil)

### RGPD
- Inclusion dans l'export Article 15 du patient si données le concernant
- Suppression Article 17 cascade : la suppression du patient anonymise/supprime aussi ses configurations

---

## 🧪 Plan de test 3 niveaux

### Tests unitaires (Vitest)
- Validation Zod : payloads conformes acceptés, malformés rejetés
- Service métier : logique de versionnement / transitions / calculs
- Couverture cible ≥ 85%

### Tests d'intégration (Vitest + Prisma + supertest)
- Endpoints API : 200 nominal, 401 sans JWT, 403 mauvais rôle, 422 règle violée
- AuditLog correctement enregistré pour chaque opération
- Transactions atomiques (rollback en cas d'erreur)
- RBAC respecté sur toutes les routes
- Versionnement : ancien et nouveau coexistent, restauration fonctionnelle
- Notification app patient déclenchée à la validation

### Tests E2E (Playwright)
- Scénario nominal complet via UI
- Vérification rôles (DOCTOR voit, VIEWER refusé, etc.)
- Multi-navigateurs (Chromium + Firefox + WebKit)

### Tests de sécurité
- Tentative d'accès à patient hors portefeuille → 403
- Injection SQL via paramètres → bloqué par Prisma
- XSS dans champs textuels → encodage React + sanitization

### Tests de conformité
- AuditLog immuable vérifié (tentative UPDATE direct → rejet)
- Données chiffrées en base (vérif via dump SQL)
- Export RGPD inclut bien cette ressource si applicable

---

## 📦 Définition de Done

### Code & qualité
- [ ] Code review approuvée (2 reviewers dont 1 senior)
- [ ] Tests unitaires verts ≥ 85% couverture
- [ ] Tests d'intégration verts
- [ ] Tests E2E verts
- [ ] Aucun `any` TypeScript injustifié
- [ ] Lint ESLint vert

### Sécurité & conformité
- [ ] AuditLog enregistré pour toutes les actions
- [ ] RBAC strict appliqué et testé
- [ ] Périmètre patient médecin vérifié
- [ ] Données chiffrées AES-256-GCM si applicable
- [ ] Validation Zod sur tous les inputs
- [ ] Validation healthcare-security-auditor

### Cohérence app patient
- [ ] Si la config impacte le patient : sync app patient testée
- [ ] Notification patient déclenchée si concerné
- [ ] Documentation API à jour (cohérence avec endpoints app)

### Documentation
- [ ] Documentation API (OpenAPI) à jour
- [ ] CHANGELOG.md mis à jour
- [ ] Si workflow : documenté dans `docs/workflows/`

### Validation métier
- [ ] Validation produit / PO
- [ ] Validation medical-domain-validator si logique clinique

### Pré-déploiement
- [ ] Migration Prisma testée sur dump de prod
- [ ] Variables d'environnement à jour
- [ ] Plan de rollback documenté

---

## 📚 Ressources

- Documentation interne : `docs/architecture/`
- Référentiel HDS ANS : https://esante.gouv.fr/produits-services/hds
- Schéma base de données : `prisma/schema.prisma` (48 tables)
- Audit log immuable : `prisma/sql/audit_immutability.sql`
- Patterns Versionnement temporel (effective dating)

---

## 🔗 US liées

- **Miroir app patient** : US-3255 (mode voyage patient)
- **Backoffice existant** : voir l'inventaire `Diabeo_Inventaire_Fonctionnalites.xlsx` (US-2001 → US-2213)
- **App patient** : `Diabeo_AppPatient_UserStories_US3000.zip` (US-3001 → US-3354)

---

*Auto-généré pour compléter l'inventaire backoffice avec les fonctions de configuration / supervision / orchestration côté médecin liées à l'app patient. Affiner manuellement selon la conception détaillée du sprint.*
