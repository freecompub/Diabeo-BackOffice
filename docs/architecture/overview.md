# Architecture — Diabeo BackOffice

## Vue d'ensemble

Diabeo BackOffice est un monolithe Next.js (App Router) qui expose une API REST pour la gestion de l'insulinothérapie. L'architecture suit un pattern en couches :

```
┌─────────────────────────────────────────────┐
│              Routes API (Next.js)            │
│  /api/auth, /api/patient, /api/analytics...  │
├─────────────────────────────────────────────┤
│              Middleware JWT                   │
│  Verification RS256, injection headers       │
├─────────────────────────────────────────────┤
│           Couche Service                     │
│  patient, insulin, analytics, events...      │
├─────────────────────────────────────────────┤
│          Couche Accès Données               │
│  Prisma ORM + PostgreSQL 16                  │
├─────────────────────────────────────────────┤
│         Infrastructure                       │
│  Chiffrement AES-256-GCM, Audit HDS         │
└─────────────────────────────────────────────┘
```

## Principes architecturaux

| Principe | Implementation |
|----------|---------------|
| Monolithe | Next.js App Router — pas de microservices (POC 50k patients) |
| Services decouplés | Chaque service est independant de Next.js, reutilisable |
| Chiffrement applicatif | AES-256-GCM sur tous les champs PII avant insertion en base |
| Audit obligatoire | Chaque acces a une donnee de sante est trace (HDS) |
| Soft delete | Les patients ne sont jamais supprimes physiquement (RGPD) |
| Transactions atomiques | Mutations + audit dans la meme transaction Prisma |

## Flux d'une requete API

```
1. Client envoie requete avec Authorization: Bearer <JWT>
2. Middleware (Edge Runtime) verifie le JWT RS256
3. Middleware injecte x-user-id et x-user-role dans les headers
4. Route handler extrait l'utilisateur via requireAuth(req)
5. Verification GDPR consent si donnees de sante
6. Verification acces patient (canAccessPatient / resolvePatientId)
7. Validation Zod des inputs
8. Appel service metier (transaction Prisma si mutation)
9. Audit log atomique dans la transaction
10. Reponse JSON (champs Decimal/BigInt serialises)
```

## Organisation du code

```
src/
├── app/api/          # Routes API (Next.js App Router)
│   ├── auth/         # Login, logout, refresh, reset-password
│   ├── account/      # Profil utilisateur, preferences, RGPD
│   ├── patient/      # Propre dossier patient
│   ├── patients/     # Acces professionnel aux patients
│   ├── cgm/          # Donnees capteur continu
│   ├── userdata/     # Donnees combinees (CGM + glycemie + insuline)
│   ├── events/       # Evenements diabete (EventForme)
│   ├── analytics/    # Profil glycemique, TIR, AGP, hypo
│   ├── insulin-therapy/ # Settings, ISF, ICR, basal, bolus
│   ├── adjustment-proposals/ # Propositions d'ajustement
│   ├── documents/    # Documents medicaux
│   ├── appointments/ # Rendez-vous
│   ├── devices/      # Appareils connectes
│   ├── sync/         # Synchronisation differentielle
│   ├── push/         # Notifications push
│   ├── announcements/ # Annonces systeme
│   ├── healthcare/   # Services et equipe soignante
│   ├── units/        # Referentiel unites de mesure
│   └── admin/        # Audit logs (admin only)
├── lib/
│   ├── auth/         # JWT RS256, RBAC, rate-limit, session, revocation
│   ├── crypto/       # AES-256-GCM, HMAC-SHA256, field encrypt/decrypt
│   ├── services/     # 15 services metier
│   ├── validators/   # Schemas Zod (events)
│   ├── statistics.ts # Fonctions pures (TIR, CV, AGP, GMI, hypo)
│   ├── proposal-algorithm.ts # Algorithme ajustement ISF/ICR/basal
│   ├── access-control.ts    # canAccessPatient, resolvePatientId
│   ├── conversions.ts       # Conversion glucose g/L, mg/dL, mmol/L
│   └── gdpr.ts              # Verification consentement RGPD
├── middleware.ts     # JWT verification globale (Edge Runtime)
└── types/            # Types TypeScript
```

## Base de données — 48 tables, 11 domaines

| Domaine | Tables | Description |
|---------|--------|-------------|
| Utilisateur & Auth | 7 | User, Account, Session, Preferences, Privacy |
| Patient & Medical | 8 | Patient, MedicalData, Administrative, Pregnancy, Objectives |
| Insulinotherapie | 8 | Settings, ISF, ICR, Basal, PumpSlots, GlucoseTargets |
| Donnees de sante | 7 | CgmEntry, GlycemiaEntry, DiabetesEvent, InsulinFlow, AverageData |
| Propositions | 1 | AdjustmentProposal (ISF/ICR/basal) |
| Appareils | 3 | PatientDevice, DeviceDataSync, InsulinFlowDeviceData |
| Equipe medicale | 4 | HealthcareService, HealthcareMember, PatientService, PatientReferent |
| Documents & RDV | 3 | MedicalDocument, Appointment, Announcement |
| Push notifications | 4 | Registration, Template, Log, Scheduled |
| Configuration UI | 3 | Dashboard, Widget, UnitDefinition |
| Audit | 1 | AuditLog (immutable via trigger PostgreSQL) |

## Decisions architecturales (ADR)

| # | Decision | Raison |
|---|----------|--------|
| 1 | Monolithe Next.js | POC 50k patients — complexite inutile |
| 2 | Chiffrement applicatif AES-256-GCM | Donnees protegees meme si BDD compromise |
| 3 | JWT RS256 custom | Compatibilite API iOS, controle total payload |
| 4 | Soft delete patients | Conformite RGPD + auditabilite |
| 5 | Transactions Prisma | Calcul + audit atomique |
| 6 | GMI (pas eA1c) | Consensus international 2019 |
| 7 | Device-aware rounding | 0.05U pompe, 0.5U stylo |
| 8 | resolvePatientId | Supporte patient self-service + acces pro |
