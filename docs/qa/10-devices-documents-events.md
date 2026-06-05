# QA — Appareils, Documents & Événements

Écrans : `/devices`, `/devices/pair`, `/documents`, `/events/new`.
Voir [conventions](README.md#3-conventions--légende).

> Écrans d'écriture côté patient/soignant. **Consentement RGPD requis** partout.
> Documents : antivirus **ClamAV** obligatoire avant stockage S3.

---

## Écran : Supervision appareils (`/devices`) 🟢

**Rôle / RBAC** : patient (ses appareils) + staff (NURSE/ADMIN). Consentement RGPD requis.
**Statut impl.** : 🟢 Réel. **Max 9 appareils** par patient.

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Appareils connectés » | visible |
| Groupes par catégorie (CGM / GLUCOMETER / PUMP / OTHER), cartes 2 colonnes | visible |
| Par appareil | nom/marque/modèle, icône Cloud si OAuth, tags connexion (bluetooth/usb/api), **indicateur sync** (vert <1 h / orange <24 h / rouge >24 h / gris jamais) |
| Bannière « hors-ligne » (>24 h) + « Actualiser tout » | si applicable |
| États | vide « Aucun appareil » + « Ajouter le 1er appareil », loading, erreur + Retry |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Charger | `GET /api/devices` + `GET /api/devices/sync-status` | groupes + indicateurs | lecture · audit READ |
| Ajouter appareil (dialog) | `POST /api/devices` `{category,brand,model,connectionTypes}` | apparaît dans la liste | INSERT `patient_device` · audit CREATE |
| OAuth (Dexcom/LibreView) | — (flow externe `window.open`) | onglet OAuth | aucun POST direct |
| Rafraîchir sync | `GET /api/devices/sync-status` | indicateurs MAJ | lecture |

```gherkin
Feature: Supervision des appareils

  Scénario: ajouter un appareil non-cloud
    Étant donné que je suis connecté en tant que "NURSE"
    Et je suis sur "/devices"
    Quand j'ajoute un appareil de catégorie "GLUCOMETER" marque "Accu-Chek" modèle "Guide"
    Alors l'appareil apparaît dans la liste
    # Effet base: INSERT patient_device + audit(CREATE/DEVICE)

  Scénario: limite de 9 appareils atteinte
    Étant donné un patient avec 9 appareils
    Quand je tente d'en ajouter un 10e
    Alors la réponse est 400 "maxDevicesReached"
```

**Cas limites** : 9 appareils max ; 403 `gdprConsentRequired` ; 404 patient introuvable.

---

## Écran : Wizard pairing appareil (`/devices/pair?patientId=X`) 🟢

**Rôle / RBAC** : `patientId` requis ; RBAC via `resolvePatientId` (patient = soi, staff = patient autorisé).
**Statut impl.** : 🟢 Réel (3 étapes + a11y live region).

### Affichage attendu

| Étape | Contenu |
|---|---|
| En-tête | « #{patientId} — Étape X/3 » + indicateur d'étapes |
| 1 — Type/Modèle | Catégorie + Marque* + Modèle* · « Suivant » désactivé si incomplet |
| 2 — N° série + connexion | SN* + fieldset connexion (bluetooth/usb/api, ≥1 requis) |
| 3 — Confirmation | récap (catégorie, marque/modèle, SN, connexions) + « Confirmer » |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Suivant / Retour | — | change d'étape | aucun |
| Confirmer | `POST /api/devices` `{patientId,category,brand,model,sn,connectionTypes}` | redirection `/patients/{id}?tab=devices` | INSERT `patient_device` · audit CREATE |

```gherkin
Feature: Pairing d'un appareil (wizard 3 étapes)

  Scénario: pairing complet
    Étant donné que je suis connecté en tant que "NURSE"
    Et je suis sur "/devices/pair?patientId=1"
    Quand je remplis le type, la marque et le modèle puis je clique "Suivant"
    Et je saisis le n° de série et sélectionne "bluetooth" puis je clique "Suivant"
    Et je clique "Confirmer"
    Alors je suis redirigé vers "/patients/1?tab=devices"
    # Effet base: INSERT patient_device + audit(CREATE/DEVICE)
```

**Cas limites** : `patientId` absent/invalide → carte « Patient requis » ; 403 consentement ; 400 `maxDevicesReached`.

---

## Écran : Documents médicaux (`/documents`) 🟢

**Rôle / RBAC** : lecture filtrée RBAC (VIEWER = `patientShare=true`). **Upload : NURSE+.** Consentement RGPD requis.
**Statut impl.** : 🟢 Réel (upload XHR avec progression, ClamAV, S3).

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Documents médicaux » + compteur | visible |
| Recherche + bouton Upload (accept .pdf/.png/.jpg/.jpeg) | visible |
| Progression upload (aria-live) / erreur upload | si applicable |
| Documents groupés par catégorie (general/forDoctor/personal/prescription/labResults/other), dépliables | visible |
| Par document | icône + titre (cliquable si PDF/image) + date + taille + bouton télécharger |
| États | loading, erreur, vide, « aucun résultat » de recherche |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Upload | `POST /api/documents` (multipart, `X-Requested-With`) | barre 0→100 % puis apparaît | **ClamAV scan** → upload **S3** → INSERT `medical_document` (fileUrl=clé S3, fileSize BigInt) · audit CREATE |
| Aperçu | — | PDF nouvel onglet · image dans dialog | aucun |
| Télécharger | `GET /api/documents/[id]/download?patientId` | téléchargement | stream S3 · audit READ (`operation:download`) |
| Rechercher | — (client) | filtre la liste | aucun |

> Limites : taille ≤ **50 Mo**, MIME ∈ {pdf, png, jpeg}.

```gherkin
Feature: Documents médicaux

  Scénario: un NURSE upload une ordonnance PDF
    Étant donné que je suis connecté en tant que "NURSE"
    Et je suis sur "/documents"
    Quand j'upload un fichier PDF valide (< 50 Mo)
    Alors la barre de progression atteint 100%
    Et le document apparaît dans sa catégorie
    # Effet base: ClamAV scan + upload S3 + INSERT medical_document + audit(CREATE)

  Scénario: fichier infecté rejeté par l'antivirus
    Quand j'upload un fichier détecté comme infecté par ClamAV
    Alors la réponse est 422 "virusDetected"
    # Effet base: AUCUN stockage S3, aucune ligne medical_document

  Scénario: type de fichier non autorisé
    Quand j'upload un fichier .docx
    Alors l'upload est refusé (type invalide)
```

**Cas limites** : 422 `virusDetected` ; 413 (>50 Mo) ; 400 MIME invalide ; 403 consentement ; 503 S3 non configuré ; VIEWER ne voit que `patientShare=true`.

---

## Écran : Création d'événement (`/events/new`) 🟢

**Rôle / RBAC** : patient (soi) / staff (via `patientId`). Consentement RGPD requis.
**Statut impl.** : 🟢 Réel. **Commentaire chiffré AES-256-GCM.**

### Affichage attendu

| Section | Contenu |
|---|---|
| Date/Heure | datetime-local requis |
| Types (multi-select) | glycemia / insulinMeal / physicalActivity / context / occasional |
| Glycémie (si sélectionné) | valeur 20–600 mg/dL (requis) |
| Insuline/Repas | glucides 0–500 (requis), bolus 0–25, basal 0–10 |
| Activité physique | type (requis) + durée 1–1440 min |
| Contexte | type (requis) |
| Occasionnel | poids 1–300, HbA1c 4.0–14.0, cétones 0–20, tension sys 50–300 / dia 20–200 |
| Commentaire | ≤ 1000 caractères |
| Boutons | « Annuler » / « Enregistrer » (désactivé si aucun type) |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Soumettre | `POST /api/events` | succès → redirection `/dashboard` ; erreur → bannière | INSERT `diabetes_event` (eventTypes[], mesures, **comment chiffré**) · audit CREATE (`metadata.patientId`) |

> Validation serveur (Zod + superRefine) : champs requis conditionnels au type
> sélectionné, bornes cliniques ci-dessus. Bolus borné 0–25 U (sécurité).

```gherkin
Feature: Création d'un événement diabète

  Scénario: enregistrer une glycémie + repas
    Étant donné que je suis connecté en tant que "VIEWER" avec consentement RGPD
    Et je suis sur "/events/new"
    Quand je sélectionne les types "glycemia" et "insulinMeal"
    Et je saisis une glycémie de 145 et 60 g de glucides
    Et je clique "Enregistrer"
    Alors je suis redirigé vers "/dashboard"
    # Effet base: INSERT diabetes_event(eventTypes=[glycemia,insulinMeal], comment chiffré) + audit(CREATE)

  Scénario: glycémie hors bornes refusée
    Quand je saisis une glycémie de 5 (sous la borne 20)
    Alors la soumission est bloquée (validation)
    # Effet base: AUCUNE insertion (400 si atteint le serveur)

  Scénario: protection des modifications non enregistrées
    Étant donné un formulaire modifié non enregistré
    Quand je tente de quitter la page
    Alors le navigateur demande confirmation
```

**Cas limites** : 403 consentement ; 404 patient ; bornes Zod (glycémie 20–600, bolus ≤25) ; commentaire ≤1000 ; garde `beforeunload` si formulaire « sale ».
