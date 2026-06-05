# QA — Écrans cliniques

Écrans : `/insulin-therapy`, `/adjustment-proposals`, `/medications`, `/import`.
Voir [conventions](README.md#3-conventions--légende).

> **Sécurité patient = priorité.** Bornes cliniques réelles
> (`src/lib/clinical-bounds.ts`) :
>
> | Paramètre | Min | Max | Unité |
> |---|---|---|---|
> | ISF | 0.10 | 1.00 | g/L/U |
> | ICR | 3.0 | 30.0 | g/U |
> | Basal | 0.05 | 5.0 | U/h |
> | Glucose cible | 60 | 250 | mg/dL |
> | Durée d'action insuline | 3.5 | 5.0 | **heures** |
> | Bolus unique max | — | 25.0 | U |
>
> ⚠️ **Anomalie doc** : ces bornes **diffèrent du `CLAUDE.md`** (qui indique ISF
> 0.20–1.00, ICR 5.0–20.0, Basal 0.05–10.0). La **référence faisant foi est le
> code** (`clinical-bounds.ts`). → mettre à jour `CLAUDE.md`.

---

## Écran : Configuration insulinothérapie (`/insulin-therapy`) 🟢

**Rôle / RBAC** : écriture **NURSE+** (API `requireRole NURSE`) ; VIEWER en lecture.
DELETE réservé DOCTOR. ⚠️ La page ne masque pas l'UI pour VIEWER (le backend
renvoie 403 à l'écriture — défense côté API uniquement).
**Statut impl.** : 🟢 Réel.

### Affichage attendu

| Élément | État attendu |
|---|---|
| Paramètres de base | marque bolus, marque basal, durée d'action, glucose cible |
| Timeline 24 h | 24 rectangles colorés (teal=ISF, corail=ICR ; gris=non couvert) |
| Slots ISF | `HH:00 – HH:00` + sensibilité **g/L/U** + Éditer/Supprimer |
| Slots ICR | `HH:00 – HH:00` + ratio **g/U** + label repas optionnel + Éditer/Supprimer |
| Paramètres avancés | toggles « Considérer IOB » + « Bolus étendu » (% 10–90, durée 15–480 min) |
| Bannières | « changements non enregistrés » + erreur |
| Boutons | « Réinitialiser aux défauts » (confirmation) + « Enregistrer » (grisé si inchangé) |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Éditer paramètres de base + Enregistrer | `PUT /api/insulin-therapy/settings` | succès, flag dirty reset | UPSERT settings · audit UPDATE |
| Ajouter/Éditer slot ISF | `POST /api/insulin-therapy/sensitivity-factors` | timeline MAJ | INSERT/UPDATE `insulin_sensitivity_factor` · audit · **borne ISF 0.10–1.00** + détection chevauchement |
| Ajouter/Éditer slot ICR | `POST /api/insulin-therapy/carb-ratios` | timeline MAJ | INSERT/UPDATE `carb_ratio` · **borne ICR 3.0–30.0** |
| Supprimer slot | `DELETE …/{id}` (au Save) | retiré (optimiste) | DELETE (best-effort) |

```gherkin
Feature: Configuration insulinothérapie

  Scénario: ajouter un slot ISF valide
    Étant donné que je suis connecté en tant que "NURSE"
    Et je suis sur "/insulin-therapy"
    Quand j'ajoute un slot ISF 08:00–12:00 avec une sensibilité de 0.50 g/L/U
    Alors le slot apparaît et la timeline est mise à jour
    # Effet base: INSERT insulin_sensitivity_factor + audit(UPDATE/CREATE)

  Scénario: sensibilité ISF hors borne refusée
    Quand j'ajoute un slot ISF avec une sensibilité de 2.00 g/L/U (> 1.00)
    Alors la valeur est refusée (validation 400)
    # Effet base: AUCUNE insertion

  Scénario: un VIEWER ne peut pas écrire
    Étant donné que je suis connecté en tant que "VIEWER"
    Quand je PUT "/api/insulin-therapy/settings"
    Alors la réponse est 403
```

**Cas limites & anomalies** :
- ✅ **A2 corrigé** : l'UI saisissait la durée d'action en **minutes** (défaut
  240, bornes 60–480) alors que l'API `PUT …/settings` valide en **heures**
  (3.5–5.0) → toute sauvegarde échouait (400). L'input est désormais en **heures**
  (défaut 4, bornes 3.5–5.0, pas 0.5).
- ⚠️ **A2b — Persistance des paramètres cassée (suivi dédié, NON corrigé ici).**
  A2 corrige l'unité, mais la **sauvegarde reste KO end-to-end** pour deux raisons
  indépendantes, à traiter dans un seul chantier « persistance insulinothérapie » :
  1. **400 `deliveryMethod` manquant** : le body `PUT` (`page.tsx handleSave`)
     n'envoie pas `deliveryMethod`, requis non-optionnel par le schéma Zod
     (`route.ts`) → `validationFailed` systématique.
  2. **500 colonnes inexistantes** : `upsertSettings` (`insulin-therapy.service.ts`)
     écrit `bolusInsulinBrand` / `basalInsulinBrand` / `insulinActionDuration` dans
     `insulin_therapy_settings`, **qui ne possède aucune de ces colonnes** (seulement
     `bolus_insulin_id`, `basal_insulin_id`, `delivery_method`) → erreur Prisma.
     Masqué en CI car les tests **mockent Prisma**.
  3. **Câblage DIA→IOB manquant** (sécurité) : même réparé, la durée saisie ne
     piloterait pas l'IOB — le moteur de bolus lit `IobSettings.actionDurationHours`
     (table distincte, défaut 4 h), jamais le champ de cet écran. Un médecin réglant
     5 h croirait modifier l'IOB sans effet.
  Correction = décision data-model (brand → FK `PatientInsulin` ; durée →
  `IobSettings.actionDurationHours` + round-trip GET) + `deliveryMethod` dans le
  body + **test d'intégration sur vraie base**. Requiert `prisma-specialist` +
  `medical-domain-validator`.
- ℹ️ **Bornes 3.5–5.0 h** (clinical-bounds, hors périmètre A2) : couvrent les
  analogues rapides adultes, mais excluent des réglages 2–3 h (pédiatrie / Fiasp /
  pompes 2–8 h). À arbitrer côté `clinical-bounds.ts` si le périmètre s'élargit.
- Chevauchement de slots : le service lève une erreur — **vérifier** qu'elle
  remonte en message utilisateur (risque 500 non explicite).
- Suppression de slot = optimiste, sans rollback visuel si le DELETE échoue.

---

## Écran : Propositions d'ajustement (`/adjustment-proposals`) 🟢

**Rôle / RBAC** : accept/reject **DOCTOR uniquement** (`requireRole DOCTOR` + `canAccessPatient`). Liste = authentifiés (filtrage backend).
**Statut impl.** : 🟢 Réel. Suggestion **jamais auto-appliquée** sans validation.

### Affichage attendu

| Élément | État attendu |
|---|---|
| Liste des propositions « pending » (cartes) | une par proposition |
| Badge paramètre | « Facteur de sensibilité (FSI) » / « Ratio I/G (RIG) » / « Débit basal » |
| Badge horodatage relatif + « Patient #N — Raison : … » | visible |
| Comparaison valeur | `ancienne → nouvelle` (2 décimales, isolation RTL) |
| Boutons « Rejeter » / « Accepter » | grisés pendant l'action |
| Annonce SR + erreur scopée à la ligne | visible |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Accepter | `PATCH /api/adjustment-proposals/[id]/accept` `{applyImmediately}` | ligne retirée | UPDATE `adjustment_proposal` (status=accepted, reviewedBy/At) · si `applyImmediately` : UPDATE params insuline · audit PROPOSAL_ACCEPTED · **FCM patient** · **bornes cliniques revalidées** |
| Rejeter | `PATCH /api/adjustment-proposals/[id]/reject` | ligne retirée | UPDATE status=rejected · audit PROPOSAL_REJECTED · FCM patient |

```gherkin
Feature: Propositions d'ajustement (validation médecin)

  Scénario: un DOCTOR accepte une proposition
    Étant donné que je suis connecté en tant que "DOCTOR"
    Et une proposition "pending" pour un de mes patients
    Quand je clique "Accepter"
    Alors la proposition disparaît de la liste
    # Effet base: UPDATE adjustment_proposal(status=accepted, reviewedBy) + audit + FCM patient

  Scénario: proposition pour un patient hors portefeuille
    Étant donné une proposition d'un patient d'un autre médecin
    Quand je tente de l'accepter
    Alors la réponse est 403 "forbidden" (erreur affichée sur la ligne)

  Scénario: valeur proposée hors bornes cliniques
    Quand j'accepte une proposition dont la valeur dépasse les bornes
    Alors l'application est rejetée
    # ⚠️ Anomalie: actuellement 500 "serverError" (devrait être 400/422) — à corriger
```

**Cas limites & anomalies** :
- ⚠️ **Bornes dépassées → 500** (au lieu de 400/422), erreur non scopée à la
  ligne — UX faible, à corriger.
- Race statut (pending→accepted entre fetch et action) → 404 `proposalNotFound`.
- Double-clic protégé (`actionPending`).

---

## Écran : Médications / BDPM (`/medications`) 🟡

**Rôle / RBAC** : authentifiés (recherche publique BDPM, **aucune** donnée patient).
**Statut impl.** : 🟡 Dépend de l'import BDPM (ANSM). Vide si l'import cron n'a pas tourné.

### Affichage attendu

| Élément | État attendu |
|---|---|
| Barre de recherche (nom / DCI / CIP, min 2 car., debounce 300 ms) | visible |
| Mention source « BDPM — ANSM (Licence Ouverte 2.0) » + date d'import | visible |
| Carte médicament | nom, DCI/substances, forme, titulaire, présentations (CIP13, remboursement, prix), badge AMM, code ATC |
| États | initial « Recherchez… (min 2 car.) », aucun résultat |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Rechercher | `GET /api/medications/search?q&atc&limit` | liste de cartes | **lecture seule** (référentiel public, pas d'audit patient) |

```gherkin
Feature: Recherche de médicaments (BDPM)

  Scénario: rechercher par DCI
    Étant donné que je suis connecté
    Et je suis sur "/medications"
    Quand je saisis "paracetamol"
    Alors je vois une liste de médicaments correspondants
    # Effet base: lecture seule du référentiel BDPM
```

**Cas limites** : base vide → « Aucun résultat » ; ATC invalide → 400 (échec silencieux UI).

---

## Écran : Import MyDiabby (`/import`) 🟡

**Rôle / RBAC** : **DOCTOR uniquement**. Consentement RGPD requis.
**Statut impl.** : 🟡 **Staging-only** (403 `stagingOnly` en production). Intégration MyDiabby partiellement mockée.

### Affichage attendu

| État | Contenu |
|---|---|
| Bandeau | « Fonctionnalité en test sur staging » |
| STAGING_ONLY (prod) | « Non disponible » |
| NO_ACCOUNTS | formulaire de connexion MyDiabby (email + mot de passe + « Connecter ») |
| HAS_ACCOUNTS | carte par compte (email masqué, badge « Connecté », dernière sync) + « Synchroniser » / « Déconnecter » |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Connecter | `POST /api/import/mydiabby/connect` | compte ajouté | INSERT credential MyDiabby (chiffré) · (staging) |
| Synchroniser | `POST /api/import/mydiabby/sync` `{credentialId}` | « N données importées » | INSERT/UPDATE données patient (CGM…) · audit |
| Déconnecter | `DELETE /api/import/mydiabby/disconnect` | carte retirée | DELETE credential · audit |

```gherkin
Feature: Import MyDiabby (staging)

  Scénario: import indisponible en production
    Étant donné un environnement de production
    Quand un DOCTOR ouvre "/import"
    Alors la réponse des endpoints est 403 "stagingOnly"
    Et l'écran affiche "Non disponible"

  Scénario: connecter un compte MyDiabby en staging
    Étant donné un environnement staging et un DOCTOR avec consentement RGPD
    Quand je connecte un compte MyDiabby valide
    Alors le compte apparaît comme "Connecté"
    # Effet base: INSERT credential MyDiabby (chiffré)
```

**Cas limites** : production → 403 `stagingOnly` ; consentement → 403 `gdprConsentRequired` ; email masqué ; import manuel uniquement (pas de job de fond).
