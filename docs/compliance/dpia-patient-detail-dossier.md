# DPIA — Dossier patient détaillé (`/patients/[id]`) + convergence des gardes de consentement

**Statut** : Brouillon — à signer DPO + RSSI avant mise en service patients réels.
**Périmètre** : la page Server Component `(dashboard)/patients/[id]` et son enfant
client `PatientDetailClient`, les sources serveur per-patient qu'elle consomme
(`patientService.getById`, `analyticsService.glycemicProfile`,
`glycemiaService.getCgmEntries`, `insulinTherapyService.getSettings`,
`documentService.{list,download}`), et la **convergence des gardes de
consentement** (PR #547) sur le helper unique `patientShareConsent`.
**Lié à** : `dpia-patients-list.md` (liste), `dpia-messaging-scope-a.md`.

## 1. Données traitées (affichées dans le dossier)

| Donnée | Catégorie RGPD | Déchiffrée serveur ? | Onglet |
|---|---|---|---|
| `User.firstname / lastname` | PII | oui (AES-256-GCM) | en-tête / vue d'ensemble |
| `User.birthday` (→ âge), `User.sex` | PII | non chiffré (low entropy) | vue d'ensemble |
| `Patient.pathology` (DT1/DT2/GD) | **Art. 9 — santé** | non chiffré | vue d'ensemble |
| `PatientMedicalData.yearDiag` (Int **en clair**), référent (nom PS) | PII / santé | non chiffré (`history*`/`diabetDiscovery` chiffrés mais **non affichés**) | vue d'ensemble |
| TIR / GMI / CV / moyenne glycémique (projection) | **Art. 9 — santé** | calcul **serveur** (`analyticsService`) | vue d'ensemble |
| Série CGM 24h (valeurs glycémie) | **Art. 9 — santé** | conversion serveur g/L→mg/dL | glycémie |
| Réglages insuline (ISF/ICR/basal par créneau) | **Art. 9 — santé** | non chiffré | traitements |
| `Treatment.name / posology` | **Art. 9 — santé** | **non chiffré (en clair)** ⚠️ | traitements |
| `MedicalDocument` (titre, catégorie, taille, date) | **Art. 9 — santé** | métadonnées ; `fileUrl` **omis** | documents |
| Contenu document (PDF…) | **Art. 9 — santé** | streamé via route dédiée | documents (download) |

**Jamais exposé au client** : `User.email/phone/nirpp/ins`, l'URL S3/MinIO
(`MedicalDocument.fileUrl` retiré par `serializeDoc`), les blobs chiffrés.

> ⚠️ Minimisation (Art. 5.1.c) : `patientService.getById` **déchiffre `email`
> en mémoire serveur** à chaque chargement du dossier, mais ne le projette PAS
> vers le client (jamais sur le réseau). Sur-déchiffrement à corriger (cf. §6).

## 2. Bases légales

- **PRO (NURSE/DOCTOR/ADMIN)** : RGPD Art. 9.2.h — prise en charge médicale par
  professionnel soumis au secret. La page est **réservée aux PRO** :
  `(dashboard)/layout.tsx` redirige tout VIEWER vers `/patient/dashboard`.
- **VIEWER (patient lui-même)** : n'atteint pas cette page (auto-service séparé).
  Pour la route `download` (atteignable par VIEWER), accès = Art. 15 (droit
  d'accès du sujet), gouverné par `MedicalDocument.patientShare`, **non gaté**
  par `shareWithProviders` (cf. §3.2).

## 3. Décisions de design à valider DPO

### 3.1 Garde de consentement fail-closed — **changement d'accès (PR #547)**

Les 4 surfaces du dossier (routes `cgm`, `analytics`, `download` [PRO], page)
utilisent désormais `patientShareConsent` (**fail-closed**) : accès PRO refusé
si le patient n'a **pas** `gdprConsent=true` **ET** `shareWithProviders=true`,
ou si la row `UserPrivacySettings` est **absente**.

**Delta de comportement vs l'état antérieur** : `cgm`/`analytics`/page/`download`
faisaient auparavant un check inline **fail-open** (`shareWithProviders` seul ;
absence de row = accès autorisé). Le durcissement aligne ces 4 surfaces sur les
~21 autres routes per-patient (glycemia, heatmap, agp, tags, referent…).

**Conséquence** : un patient **sans consentement RGPD enregistré** (ex. dossier
fraîchement créé, parcours de consentement non terminé) ou ayant **révoqué le
partage** devient **invisible côté PRO** sur tout le dossier détaillé (404 si
patient inexistant/soft-deleted ; sinon état « partage désactivé », aucune PII
déchiffrée). Conforme RGPD Art. 7.3 (révocation effective immédiate).

**⚠️ Asymétrie liste ↔ détail (à acter)** : la **liste/recherche**
(`listByDoctor`/`search`, cf. `dpia-patients-list.md`) reste **fail-open**
(`PROVIDER_VISIBLE_USER_WHERE` : absence de row privacy = patient visible),
tandis que le **dossier détaillé** est désormais **fail-closed**. Conséquence
UX : un patient sans row/consentement apparaît dans le portefeuille du PS, mais
le clic ouvre un dossier **« partage désactivé » vide** (aucune PII).

**Décision DPO requise** : valider que la base légale Art. 9.2.h (soin) soit
**subordonnée** au `gdprConsent`+`shareWithProviders` du patient sur le dossier
PRO, malgré l'asymétrie ci-dessus. Risque opérationnel à acter : un PS ne voit
pas le contenu d'un patient tant que le consentement n'est pas saisi → prévoir
que le parcours de création/consentement pose la row `UserPrivacySettings` avec
les flags adéquats.

### 3.2 Exemption VIEWER sur le téléchargement de documents

`/api/documents/[id]/download` exempte le VIEWER de la garde `shareWithProviders`
(`if (user.role !== "VIEWER")`), car ce flag gouverne le partage **avec les
soignants**, pas l'auto-accès du sujet. Le VIEWER reste borné à ses propres
documents : `resolvePatientId` force son `patientId` (pas d'IDOR) et
`documentService.download` applique `MedicalDocument.patientShare`.

**⚠️ Gate `requireGdprConsent(user.id)` en amont** : la route download appelle
`requireGdprConsent(user.id)` (consentement **de l'appelant**) pour **tous les
rôles, VIEWER inclus**, AVANT l'exemption ci-dessus. Donc un VIEWER qui n'a pas
posé son propre `gdprConsent=true` est **bloqué de ses propres documents**
(403 `gdprConsentRequired`) — tension avec Art. 15 (droit d'accès). Sémantique
« consent de l'appelant vs du sujet » à revoir (TODO V1.5 documenté dans
`src/lib/gdpr.ts`).

**Décision DPO requise** : (a) confirmer que l'opt-out `shareWithProviders` ne
bloque jamais l'auto-accès du patient (Art. 15) ; (b) arbitrer le gate
`requireGdprConsent(self)` qui peut, lui, bloquer l'auto-accès.

### 3.3 `Treatment.name / posology` en clair (Art. 9)

Contrairement à l'identité (`firstname/lastname/email` AES-256-GCM) et aux
antécédents (`PatientMedicalData` chiffrés), le nom de médicament et la posologie
sont stockés **en clair**. Le double rideau pgcrypto (at-rest, ADR #8) couvre
partiellement, mais pas la protection applicative si la BDD est compromise.

**Décision DPO requise** : accepter le risque (documenté) **ou** planifier le
chiffrement de `Treatment.{name,posology,other,posologyData}` (backlog).

### 3.4 Asymétrie code retour download (404 → 403)

Depuis #547, `download` renvoie `403 sharingDisabled/patientConsentMissing`
(comme `cgm`/`analytics`) au lieu d'un `404` uniforme. Pour un PRO ayant déjà
passé `canAccessPatient`/`resolvePatientId`, l'existence du patient n'est pas un
secret → pas de fuite d'énumération nouvelle. Posture acceptée.

## 4. Mesures techniques en place

- Garde d'accès `canAccessPatient` (RBAC portefeuille) **avant** toute lecture ;
  refus → `auditService.accessDenied` (`UNAUTHORIZED`, détection d'abus US-2265)
  + `notFound()` (404 uniforme anti-énumération) sur la page.
- Garde consentement `patientShareConsent` **avant** tout déchiffrement PII.
- Déchiffrement PII **strictement serveur** ; aucune PII en clair dans les logs ;
  pas de PHI en URL (ids numériques uniquement) ; `fileUrl` jamais transmis.
- Toutes statistiques cliniques **calculées serveur** (TIR/GMI/CV) — zéro calcul
  clinique frontend. Aucune IA.
- Audit per-source (ADR #18) **avec pivot `metadata.patientId`** :
  `READ PATIENT` (getById), `READ ANALYTICS`, `READ INSULIN_THERAPY`,
  `READ MEDICAL_DOCUMENT` (+ `download`, `operation:"download"`),
  `READ CGM_ENTRY`, `READ GLYCEMIA_ENTRY`, `READ BOLUS_LOG` — pivot harmonisé.
- Headers ANSSI RGS §4.5 : `/patients` ajouté à `PHI_PATH_PREFIXES` (no-store,
  no-referrer, nosniff) ; téléchargement durci (CSP `default-src 'none'`,
  `X-Frame-Options DENY`).
- Antivirus **ClamAV à l'upload** (`documentService.upload`) — les blobs stockés
  sont scannés à l'ingestion ; **pas** de scan au download.
- Caveat clinique « capture CGM < 70 % » + signal de fraîcheur sur le dernier
  relevé (sécurité d'interprétation).

## 5. Tests

- `tests/components/patient-detail-client.test.tsx` — rendu des 4 onglets +
  états vides + consentement désactivé (aucune PII rendue).
- `tests/unit/{glycemia,treatment,document}-view.test.ts` — mappings purs.
- `tests/integration/api-documents-download-consent.test.ts` — garde
  consentement download (PRO refusé → 403 sans stream ; PRO ok ; VIEWER exempt).
- `patientShareConsent` couvert par `tests/unit/consent-and-decimal.test.ts`.

## 6. Risques résiduels (backlog)

- `Treatment.*` en clair (§3.3).
- Sur-blocage possible du VIEWER sur `glycemia` GET (admet VIEWER mais applique
  `patientShareConsent`) — à investiguer/exempter.
- ✅ Pivot `metadata.patientId` sur `READ CGM_ENTRY`/`GLYCEMIA_ENTRY`/`BOLUS_LOG`
  — **harmonisé** (PR audit pivot).
- Plancher capteur 0.40 g/L exclut les hypo sévères des agrégats.
- ✅ Cibles grossesse (GD) — défauts pathology-aware (63–140) sur le calcul TIR
  et le badge (`getCgmDefaults`). **Résolu.**
- ⚠️ **Inférence du mode grossesse depuis la cible exposée (US-2641)** — depuis
  l'unification `getPatientThresholds` `pregnancyMode`-aware, une patiente
  `pregnancyMode` (même non typée GD) reçoit une cible stricte 63–140 dans les
  agrégats de la fiche. Un PS peut donc **inférer l'état de grossesse** (donnée
  Art. 9) depuis la cible affichée. **Risque résiduel accepté** : diffusion
  limitée aux soignants **déjà autorisés** (RBAC + `requireGdprConsent` +
  `patientShareConsent` + opt-out sujet), la cible est nécessaire au rendu
  clinique (base légale = prise en charge, Art. 9.2.h), et l'inférence n'entre
  **dans aucun log d'audit** (`pregnancyMode` lu uniquement en interne pour les
  seuils, jamais restitué en metadata). Aucune minimisation supplémentaire
  praticable sans dégrader la sécurité clinique (la cible EST une information de
  soin).
- Sur-déchiffrement `email` dans `getById` (minimisation Art. 5.1.c).

## 7. Validations à obtenir

- [ ] DPO : approbation §3.1 (consentement fail-closed subordonnant Art. 9.2.h ;
  acter le risque opérationnel "patient sans consentement invisible côté PRO").
- [ ] DPO : confirmation §3.2 (exemption VIEWER auto-accès documents).
- [ ] DPO : décision §3.3 (chiffrer `Treatment.*` ou risque accepté).
- [ ] RSSI : revue des mesures §4 (no-store `/patients`, ClamAV, audit pivots).
- [ ] Direction Médicale : revue caveat capture CGM + fraîcheur (§4) et cibles GD.

---

*Dernière mise à jour : 2026-07-01 — épopée fiche patient unifiée (US-2630,
PR #608→#619) : ajout du risque résiduel « inférence du mode grossesse depuis la
cible » (§6, US-2641). Précédemment : câblage dossier (PR #543→#546),
convergence consentement (PR #547).*
