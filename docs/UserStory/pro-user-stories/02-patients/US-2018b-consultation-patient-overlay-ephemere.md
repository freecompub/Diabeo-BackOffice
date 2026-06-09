# US-2018b — Consultation patient en overlay éphémère (sélection patient → vues patient-centrées)

> Résout un problème de navigation identifié en revue : les vues **patient-scoped**
> (au premier chef le **profil glycémique** `/analytics` : AGP, TIR, hypos) sont
> **inatteignables pour un professionnel**. Côté API, `resolvePatientId` exige un
> patient explicite pour DOCTOR/NURSE/ADMIN (sinon 404), mais aucune UI ne permet
> au médecin de **sélectionner** un patient pour ouvrir ses analyses. Cette US
> introduit le **workspace patient en overlay**, ouvert depuis la liste, avec une
> **référence patient éphémère** (ni id ni rien de partageable dans l'URL).
>
> Les décisions de design ci-dessous ont été validées en session via des maquettes
> interactives (support de discussion, non versionnées).

---

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2018b` |
| **Domaine** | 02. Patients |
| **Priorité** | **V1** |
| **Pays cible** | Universel |
| **Intégration externe** | Non |
| **Service / Standard** | Interne (Next.js App Router, Upstash Redis) |
| **Statut** | 🆕 À démarrer |
| **Story points** | **8** (Fibonacci) |
| **Dépendances** | US-2016 (liste patients), US-2018 (fiche patient), US-2400→2404 (dashboard médecin), `/analytics` (profil glycémique existant), `access-control.ts` (`canAccessPatient`/`resolvePatientId`), Upstash Redis |
| **Sprint cible** | À définir |
| **Owner** | — |

---

## 📋 Contexte métier

### Problème

Le **profil glycémique riche** (`/analytics` : AGP percentiles, Time-in-Range 5 zones,
compteur d'hypoglycémies, HbA1c estimée, CV/SD) est **patient-centré** :

- **VIEWER** (le patient) → `resolvePatientId` renvoie **son propre dossier**.
- **DOCTOR / NURSE / ADMIN** → un patient **explicite** est requis (`canAccessPatient`) ;
  sans patient → **404**.

Or l'item de menu « Analytics » n'envoie aucun patient et **n'a pas de sélecteur** :
il **renvoie 404 pour tout professionnel**, et **aucun lien dans l'UI** ne permet à un
médecin d'ouvrir le profil glycémique d'un patient donné. La fonctionnalité existe mais
est **inaccessible** aux soignants.

### Posture de sécurité retenue (décision produit)

Le client (médecin/infirmier) **ne doit pas pouvoir partager** un dossier patient par URL,
et la **référence patient doit être éphémère** : valable le temps de la consultation,
**détruite à la fermeture**, **non rejouable**. En conséquence :

- **Aucun identifiant patient dans l'URL** (ni l'`id` séquentiel, ni l'UUID `publicRef`).
  L'URL reste `/patients`. → Partage par lien **impossible** par construction.
- La référence active est un **jeton éphémère serveur** (`cTok`) lié à
  `{ utilisateur, patient, TTL court }`, jamais exposé dans la barre d'adresse.
- **Audit HDS préservé** : le serveur sait quel patient est consulté (via le jeton),
  la traçabilité reste complète sans exposer l'id côté navigateur.

### Décisions de design figées (validées via maquettes)

| Aspect | Choix |
|---|---|
| Forme | **Drawer latéral** + bouton **« Agrandir »** (→ plein écran à la demande) |
| Sidebar de l'app | **Grisée + inerte** pendant la consultation |
| Sous-navigation | **Onglets horizontaux** |
| Périmètre MVP | **Toutes les sections** : Vue d'ensemble · Profil glycémique · Glycémie · Traitements · Documents |
| URL | reste `/patients` — **aucun id patient** |
| Référence patient | **jeton éphémère** serveur, détruit à la fermeture, non rejouable |
| Refresh (F5) | referme la consultation → retour liste (comportement attendu, sans gravité) |

---

## ✅ Critères d'acceptation

### AC-1 — Ouverture du workspace depuis la liste

```gherkin
Scenario: un médecin ouvre la consultation d'un patient
  Given je suis DOCTOR sur "/patients" (mon portefeuille)
  When je clique sur un patient de la liste
  Then un overlay (drawer) s'ouvre par-dessus la liste avec ses onglets
  And la sidebar de l'app est grisée et non cliquable
  And l'URL reste "/patients" (aucun identifiant patient)
  # Effet base: POST /api/consultation/open {patientRef} → canAccessPatient OK
  #   → jeton cTok créé (Redis, TTL) + audit READ/PATIENT (metadata.patientId)
```

### AC-2 — Référence éphémère (jeton) et non-partageabilité

```gherkin
Scenario: la consultation n'est pas partageable par URL
  Given une consultation ouverte sur un patient
  When je copie l'URL de la page
  Then l'URL copiée est "app.diabeo.fr/patients" et ne mène à aucun patient
  When un collègue ouvre ce lien
  Then il arrive sur SA propre liste, jamais sur le patient

Scenario: le jeton est lié à l'utilisateur émetteur
  Given un jeton cTok émis pour le médecin A sur le patient P
  When ce jeton est présenté par un autre utilisateur B
  Then l'accès est refusé (le jeton est lié à {A, P})
```

### AC-3 — Fermeture et refresh détruisent le jeton (non rejouable)

```gherkin
Scenario: fermeture explicite
  Given une consultation ouverte
  When je clique "Fermer" (ou clic en dehors du drawer)
  Then l'overlay disparaît et la sidebar redevient active
  And le jeton cTok est invalidé côté serveur (non rejouable)
  # Effet base: POST /api/consultation/close {cTok} → DELETE Redis

Scenario: rafraîchissement de page
  Given une consultation ouverte
  When je rafraîchis la page (F5)
  Then l'application se recharge sur la liste "/patients" (overlay fermé)
  And le jeton cTok est détruit : immédiatement via sendBeacon, sinon par expiration TTL
  And aucune copie du jeton ne subsiste côté client (mémoire effacée)
```

### AC-4 — Une seule consultation active par utilisateur

```gherkin
Scenario: ouvrir un nouveau patient invalide le précédent
  Given une consultation ouverte sur le patient P1
  When j'ouvre le patient P2
  Then le jeton de P1 est invalidé et un nouveau jeton est émis pour P2
  # Garantit au plus 1 dossier "ouvert" par utilisateur + pas d'accumulation Redis
```

### AC-5 — Données patient via le jeton (id jamais dans l'URL navigateur)

```gherkin
Scenario: les vues chargent les données via le jeton
  Given une consultation ouverte (onglet "Profil glycémique")
  When les graphes AGP / TIR / hypos se chargent
  Then les appels API portent le jeton (en-tête), jamais l'id patient dans la barre d'adresse
  And le serveur résout cTok → patient, re-vérifie l'accès et audite
  # Le path VIEWER (/analytics sans jeton) reste inchangé : son propre dossier
```

### AC-6 — RBAC & périmètre (anti-énumération)

```gherkin
Scenario: impossible d'ouvrir un patient hors portefeuille
  Given un patient hors de mon portefeuille
  When une tentative d'ouverture est forgée avec sa référence
  Then la réponse est un refus neutre uniforme (404 patientNotFound)
  And aucune information distinguant "inexistant" de "hors périmètre" n'est exposée
```

---

## 🛠️ Mécanique technique

### Identifiants
- Le client ne manipule **jamais** l'`id` séquentiel : la liste expose le **`publicRef`**
  (UUID opaque déjà présent sur `Patient`, `gen_random_uuid()`). L'ouverture envoie
  `patientRef = publicRef` ; le serveur résout `publicRef → id` en interne.

### Endpoints (nouveaux)
- `POST /api/consultation/open` — body `{ patientRef }`.
  `requireRole(DOCTOR|NURSE|ADMIN)` → `canAccessPatient` → **invalide le jeton actif
  précédent** de l'utilisateur (single-active) → forge `cTok` (aléatoire) en Redis
  `consultation:{cTok} → { userId, patientId, exp }` (TTL court, ex. 15 min, glissant)
  → `auditService.log(READ/PATIENT, metadata.patientId)` → renvoie `{ cTok, patient }`
  (nom d'affichage déchiffré + pathologie, **pas** l'id).
- `POST /api/consultation/close` — body `{ cTok }` → `DELETE` Redis (idempotent).
  Appelé sur clic « Fermer » **et** via `navigator.sendBeacon` sur `pagehide`/`beforeunload`.

### Lecture des données patient (path professionnel)
- Les routes `/api/analytics/*` (et, à terme, glycémie/traitements/documents) acceptent
  un en-tête `X-Consultation-Token: cTok`. Un helper `resolvePatientFromConsultation(req, user)`
  lit le jeton, vérifie le binding `userId`, **rafraîchit le TTL** (sliding), renvoie le
  `patientId`. Path **VIEWER inchangé** (pas de jeton → `resolvePatientId` → propre dossier).
- Aucun `?patientId=` ni `publicRef` n'apparaît dans la **barre d'adresse** ; le jeton ne
  circule qu'en en-tête d'XHR (non partageable comme une page).

### UI
- Overlay = **état client** dans `NavigationShell` / page `/patients` (pas de changement
  d'URL, pas d'intercepting route — cohérent avec « URL sans id »).
- `patientRef` + `cTok` vivent **en mémoire** uniquement (interdits : `localStorage`,
  cookies non-httpOnly — cf. CLAUDE.md). F5 ⇒ mémoire effacée ⇒ overlay fermé.
- Composant `PatientConsultationDrawer` : header patient + onglets horizontaux + bouton
  Agrandir (drawer ↔ plein écran). La sidebar passe `aria-hidden` + `inert` quand ouverte.

---

## ♿ Accessibilité

- **Focus trap** dans le drawer à l'ouverture ; `Échap` ferme ; focus rendu à la ligne
  patient de la liste à la fermeture (focus management).
- Sidebar grisée → `inert` + `aria-hidden="true"` (réellement hors tabulation).
- Ouverture annoncée en `aria-live="polite"` : « Consultation de {patient} ouverte ».
- Onglets = pattern `Tabs` shadcn (ARIA tablist déjà conforme).
- Drawer : `role="dialog"` `aria-modal="true"` `aria-labelledby` (nom patient).

## 🌍 i18n

Nouvelles clés (namespace `consultation`) FR/EN/AR : `open`, `close`, `expand`, `collapse`,
`ephemeralNotice`, `tabs.{overview,glycemicProfile,glycemia,treatment,documents}`,
`patientInaccessible`, `openedAnnounce`. Réutilise `analytics.*` pour les graphes.

---

## 🔭 Hors périmètre (follow-up)

- **Branchement des onglets sur l'API réelle** : la fiche `/patients/[id]` est encore en
  données démo (`DEMO_*`) ; les onglets Glycémie/Traitements/Documents devront pointer sur
  les vrais services (peut être incrémenté section par section).
- **Dashboards infirmier/admin** : mêmes entrées « ouvrir un patient » à généraliser (suite
  logique, cf. US-2112d i18n).
- **Variante « contexte global persistant »** (topbar multi-vues) : explicitement écartée
  (risque clinique « mauvais patient » + persistance contrainte) — non retenue.

## 📈 Plan d'incréments

| Inc. | Contenu |
|---|---|
| **MVP** | Endpoints `consultation/open|close` + jeton Redis (TTL, single-active, sendBeacon) + `PatientConsultationDrawer` (drawer + agrandir, sidebar inerte, onglets) + onglet **Profil glycémique** câblé via `X-Consultation-Token`. Ouverture depuis `/patients`. |
| **V1.1** | Onglets Vue d'ensemble / Glycémie / Traitements / Documents câblés sur les services réels. |
| **V1.2** | Entrées « ouvrir un patient » depuis les dashboards (médecin → Patients à suivre, etc.). a11y/i18n complets. |
