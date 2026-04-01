# API Routes — Resume complet

## Authentification (Phase 1)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | /api/auth/login | Non | Connexion email + password |
| POST | /api/auth/logout | JWT | Deconnexion + invalidation session |
| POST | /api/auth/refresh | JWT (expire) | Renouvellement token |
| POST | /api/auth/reset-password | Non | Demande reset (anti-enumeration) |

## Compte utilisateur (Phase 1)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/account | JWT | Profil complet (dechiffre) |
| PUT | /api/account | JWT | Mise a jour profil |
| DELETE | /api/account | JWT | Suppression RGPD (cascade) |
| PUT | /api/account/photo | JWT | Upload photo (501 — TODO S3) |
| PUT | /api/account/terms | JWT | Acceptation CGU |
| PUT | /api/account/data-policy | JWT | Politique donnees |
| GET/PUT | /api/account/units | JWT | Preferences d'unites |
| GET/PUT | /api/account/privacy | JWT | Parametres confidentialite |
| GET/PUT | /api/account/notifications | JWT | Preferences notifications |
| GET/PUT | /api/account/day-moments | JWT | Periodes journalieres |
| GET | /api/account/export | JWT | Export RGPD (JSON) |

## Dossier patient (Phase 2)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/patient | JWT + GDPR | Propre profil patient |
| PUT | /api/patient | JWT + GDPR | Mise a jour pathologie |
| GET | /api/patients/:id | NURSE+ | Dossier patient (pro) |
| PUT | /api/patients/:id | DOCTOR+ | Mise a jour patient (pro) |
| GET/PUT | /api/patient/medical-data | JWT + GDPR | Donnees medicales |
| GET | /api/patient/objectives | JWT + GDPR | Objectifs glycemiques |
| PUT | /api/patient/objectives | DOCTOR+ | CGM objectives |
| PATCH | /api/patient/objectives | DOCTOR+ | Annex objectives |
| GET | /api/patient/pregnancy | JWT + GDPR | Grossesse active |
| POST | /api/patient/pregnancy | JWT + GDPR | Nouvelle grossesse |
| PUT | /api/patient/pregnancy/:id | JWT + GDPR | Mise a jour grossesse |

## Donnees de sante (Phase 3)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/cgm | JWT + GDPR | Donnees CGM brutes |
| GET | /api/userdata | JWT + GDPR | Donnees combinees |
| POST | /api/events | JWT + GDPR | Creer evenement diabete |
| PUT | /api/events/:id | JWT + GDPR | Modifier evenement |
| DELETE | /api/events/:id | JWT + GDPR | Supprimer evenement |

## Analytics (Phase 3)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/analytics/glycemic-profile | JWT + GDPR | Profil glycemique (GMI, CV, TIR) |
| GET | /api/analytics/time-in-range | JWT + GDPR | TIR 5 zones |
| GET | /api/analytics/agp | JWT + GDPR | Profil AGP (96 slots) |
| GET | /api/analytics/hypoglycemia | JWT + GDPR | Episodes hypoglycemiques |
| GET | /api/analytics/insulin | JWT + GDPR | Resume insuline |

## Insulinotherapie (Phase 4)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/insulin-therapy/settings | JWT + GDPR | Parametres complets |
| PUT | /api/insulin-therapy/settings | JWT + GDPR | Mise a jour parametres |
| DELETE | /api/insulin-therapy/settings | DOCTOR+ | Suppression cascade |
| GET/POST | /api/insulin-therapy/sensitivity-factors | JWT + GDPR | Creneaux ISF |
| GET/POST | /api/insulin-therapy/carb-ratios | JWT + GDPR | Creneaux ICR |
| POST | /api/insulin-therapy/calculate-bolus | JWT + GDPR | Calcul bolus |
| GET | /api/insulin-therapy/bolus-logs | JWT + GDPR | Historique bolus |

## Propositions d'ajustement (Phase 4)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/adjustment-proposals | JWT + GDPR | Liste propositions |
| GET | /api/adjustment-proposals/summary | JWT + GDPR | Compteurs par statut |
| PATCH | /api/adjustment-proposals/:id/accept | DOCTOR+ | Accepter proposition |
| PATCH | /api/adjustment-proposals/:id/reject | DOCTOR+ | Rejeter proposition |

## Equipe soignante (Phase 5)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/healthcare/services | NURSE+ | Liste services de sante |
| GET | /api/healthcare/members | JWT + GDPR | Equipe du patient |
| POST | /api/patient/services | JWT + GDPR | Inscription a un service |
| PUT | /api/patient/referent | DOCTOR+ | Definir medecin referent |
| GET | /api/patients | NURSE+ | Liste patients du pro |
| GET | /api/patients/:id/cgm | NURSE+ | CGM patient (pro) |
| GET | /api/patients/:id/analytics | NURSE+ | Analytics patient (pro) |
| POST | /api/patients/:id/glycemia | NURSE+ | Saisie pro glycemie |

## Documents et rendez-vous (Phase 5)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/documents | JWT + GDPR | Liste documents |
| POST | /api/documents | JWT + GDPR | Creer document |
| GET/POST | /api/appointments | JWT + GDPR | Rendez-vous |

## Appareils et sync (Phase 6)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET/POST | /api/devices | JWT + GDPR | Appareils connectes (max 9) |
| GET | /api/devices/sync-status | JWT | Etat synchronisation |
| POST | /api/sync/pull | JWT + GDPR | Pull differentiel (conflict 409) |
| POST | /api/sync/push | JWT + GDPR | Push + increment sequence |

## Push notifications (Phase 7)

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET/POST/DELETE | /api/push/register | JWT | Tokens push (masques) |
| GET | /api/push/templates | NURSE+ | Templates notifications |
| GET/POST | /api/push/scheduled | NURSE+ | Notifications planifiees |
| GET | /api/announcements | JWT | Annonces actives |
| POST | /api/announcements | ADMIN | Creer annonce |

## Admin

| Methode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | /api/admin/audit-logs | ADMIN | Logs d'audit avec filtres |
| GET | /api/units | JWT | Referentiel unites |
