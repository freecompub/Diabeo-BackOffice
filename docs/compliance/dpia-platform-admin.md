# DPIA — Administration plateforme Diabeo (US-2613, PR6a backend)

**Statut** : Brouillon — à signer DPO + RSSI avant mise en service patients réels.
**Périmètre (PR6a)** : services `tenant.service`, `verification-policy.service`,
`ps-registration.service`, `platform-admin.service` + routes `/api/admin/{tenants,
verification-policies,ps-registrations,platform/*}`. UI = PR6b.
**Lié à** : `dpia-access-foundations.md` (tenant, politique de vérification, capacités
Q1/Q2), `dpia-cabinet-management.md` (invitation, révocation immédiate), `dpia-session-security.md`
(F7), `admin-plateforme-diabeo-us.md`.

## 1. Données traitées

| Donnée | Catégorie | Traitement |
|---|---|---|
| `Tenant.name` / `country` | métadonnée d'organisation | en clair |
| `VerificationPolicy` (mode, expiresAt, tenant/pays, setBy) | métadonnée d'accès | en clair, append-only, audité |
| `ProfessionalRegistration` (country, scheme, number, method, status) | preuve professionnelle | en clair (pas de PHI) |
| Identité PS / personnel (`User.firstname/lastname/email`) | PII | chiffrée AES-256-GCM ; déchiffrée **serveur** pour la revue (SYSTEM_ADMIN autorisé) |
| Appartenances/capacités (`HealthcareMembership`) | métadonnée d'accès | en clair |
| Token d'invitation bootstrap (`VerificationToken`) | secret | single-use, TTL 1h, keyé `emailHmac` (F15) |

**Aucune donnée de santé.** Le `SYSTEM_ADMIN` administre **structures + comptes +
config** — jamais le dossier clinique en clair (séparation hébergeur ↔ soignant).

## 2. Modèle d'autorisation

- **Espace réservé `SYSTEM_ADMIN`** (= rôle `ADMIN` en V1 ; renommage `SYSTEM_ADMIN`
  + découplage accès-PHI / rôle-plateforme = **F1/V4**). Toutes les routes gardées
  `requireRole(req, "ADMIN")` (filtrage serveur ; absent du DOM sinon — UI PR6b).
- **Session unique (V1)** : déjà en place (PR2 #565, mono-session backoffice).
- **Politique de vérification — fail-secure à l'écriture** (miroir de la résolution
  `capabilities.resolveVerificationPolicy`) :
  - cible = **tenant XOR pays** (jamais les deux, jamais aucun) ;
  - `provisional` exige un `expiresAt` **futur** (`expiresAtRequired` sinon) ;
  - en **production**, `provisional` refusé sauf flag pilote `VERIFICATION_ALLOW_PILOT`
    (`provisionalForbiddenInProd`). On n'écrit jamais une politique qui serait
    silencieusement dégradée en `required` à la lecture.
- **Bootstrap = PREMIER org-admin uniquement** : refusé si un admin principal existe
  déjà (`alreadyBootstrapped`) → un seul point de départ par établissement, le reste
  passe par la gestion cabinet normale (US-2610).
- **Non-contournement de la vérification PS** : le `SYSTEM_ADMIN` **statue** sur une
  preuve déposée (`unverified → verified | rejected`), il ne **fabrique** pas une
  qualité PS sans preuve. Garde d'état : une preuve déjà tranchée n'est pas re-décidée.
- **Révocation incident cross-tenant** : délègue à `org-membership.revokeMember` en
  `ADMIN` (révocation immédiate F7 : bump `authVersion` + `invalidateAllUserSessions`).

## 3. Traçabilité (BASELINE-AUDIT, immuable)

Toute action plateforme est auditée (acteur, cible, scope, horodatage) via les actions
canoniques du socle (US-2620) : `CREATE`/`UPDATE` (TENANT, HEALTHCARE_SERVICE),
`VERIFICATION_POLICY_CHANGED` / `VERIFICATION_PROVISIONAL_SET`, `PS_PROOF_VALIDATED` /
`PS_PROOF_REJECTED`, `ORG_ADMIN_BOOTSTRAPPED`, `CAPABILITY_REVOKED`. `tenantId` /
`scopeServiceId` renseignés pour le forensic CNIL/ANS.

## 4. Risques résiduels V1 (acceptés, à lever en V4)

1. **`ADMIN` conserve le bypass PHI** — la garantie « `SYSTEM_ADMIN` sans accès aux
   données de santé » n'est **effective qu'en V4** (dépend de **F1** : découplage
   accès-PHI / rôle-plateforme). Mesure transitoire : ne pas confier de rôle plateforme
   à un non-soignant (cf. US-2610 §Phasage).
2. **Vérification PS « réelle » reportée V4** — V1 = validation **manuelle** minimale
   (`verified`/`rejected`) ; pas d'API RPPS, pas de cycle de vie complet ni de cadence
   de re-vérification (US-2611, V4). En V1 la gate clinique reste « considérée vérifiée »
   selon la politique.
3. **MFA forte SYSTEM_ADMIN** (TOTP/passkey, SMS exclu — F9) = **V4** ; V1 s'appuie sur
   la MFA existante + session unique.
4. **Support / impersonation sans PHF** (US-2614) = **V4** ; en V1-V3 l'accès reste total
   (cohérent avec le report de F1).
5. **Bootstrap non-atomique établissement↔admin** : la création d'établissement
   (route existante) et le bootstrap de l'admin sont deux appels distincts ; un échec du
   bootstrap laisse un établissement sans admin principal (récupérable : ré-invoquer le
   bootstrap). Pas de perte de données, pas d'accès indu.

## 5. Conformité

- **RGPD Art. 9** : aucune donnée de santé manipulée sur cet espace.
- **RGPD Art. 5(1)(f)** : intégrité/confidentialité — PII chiffrée, audit immuable.
- **HDS / ANS** : traçabilité exhaustive des actions plateforme, fail-secure sur la
  porte d'accès clinique (politique de vérification).
- **Décisions ouvertes US-2613** (provisioning `SYSTEM_ADMIN` par l'admin Diabeo ;
  suppression/anonymisation d'établissement sur demande officielle hors interface ;
  renommage `ADMIN`→`SYSTEM_ADMIN`) : tracées, non implémentées en V1.
