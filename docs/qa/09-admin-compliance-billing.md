# QA — Conformité & Facturation (Admin)

Écrans : `/admin/data-breaches` (+`[id]`), `/admin/invoices` (+`[id]`), `/admin/tax-rules`.
Voir [conventions](README.md#3-conventions--légende).

> Tous **ADMIN only** côté UI (`redirect("/")`). Les transitions de violation
> RGPD exigent un **step-up MFA** + sont **idempotentes**.

---

## Écran : Violations de données — RGPD Art. 33 (`/admin/data-breaches`) 🟢

**Statut impl.** : 🟢 Réel.

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Violations de données (RGPD Art. 33) » | visible |
| Filtres statut (draft / under_assessment / notified_cnil / notified_users / closed) + sévérité (low/medium/high/critical) | visible |
| Bouton « Déclarer une violation » | visible |
| Ligne violation | titre, badge sévérité, badge statut, date détection, **délai CNIL en rouge si dépassé / orange si < 12 h** |
| États | vide « Aucune violation enregistrée », erreur réseau |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Filtrer | `GET /api/admin/data-breaches?status&severity` | liste | **lecture** · audit (DATA_BREACH list) |
| Déclarer (dialog) | `POST /api/admin/data-breaches` | dialog ferme, liste rafraîchie | INSERT `data_breach` (status=draft, **description chiffrée AES-256-GCM**, declaredBy) · audit CREATE |

> Zod déclaration : `severity` enum, `title` 1–200, `description` ≤ 5000.
> ⚠️ Le formulaire avertit « NE PAS inclure de PHI/PII dans le titre » (titre non chiffré).

```gherkin
Feature: Registre des violations de données (RGPD Art. 33)

  Scénario: déclarer une violation
    Étant donné que je suis connecté en tant que "ADMIN"
    Et je suis sur "/admin/data-breaches"
    Quand je clique "Déclarer une violation"
    Et je choisis la sévérité "high" et un titre sans PHI
    Et je confirme
    Alors la violation apparaît dans la liste au statut "draft"
    # Effet base: INSERT data_breach(status=draft, description chiffrée) + audit(CREATE/DATA_BREACH)
```

**Cas limites** : délai CNIL 72 h (flag dépassé) ; sévérité low/medium → pas d'alerte CNIL ; confirmation si on ferme un formulaire « sale ».

---

## Écran : Détail violation + transitions FSM (`/admin/data-breaches/[id]`) 🟢

**Statut impl.** : 🟢 Réel. **FSM** : draft→{under_assessment, closed} ; under_assessment→{notified_cnil, closed} ; notified_cnil→{notified_users, closed} ; notified_users→{closed} ; closed = terminal.

### Affichage attendu

| Élément | État attendu |
|---|---|
| En-tête (titre + badges sévérité/statut) + **alerte CNIL** (dépassé rouge / < 12 h orange) | visible |
| Section « Détails » (detectedAt, declaredBy, cnilNotifiedAt, usersNotifiedAt, closedAt) | visible |
| Champs chiffrés (description, remediation, cnilCaseNumber) + bouton « Modifier » (désactivé si closed) | visible |
| Section « Workflow FSM » | boutons des transitions autorisées ; saisie « Nombre d'utilisateurs notifiés » si transition `notified_users` |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Charger | `GET /api/admin/data-breaches/[id]` | détail (champs déchiffrés) | lecture · audit READ |
| Éditer champs | `PATCH /api/admin/data-breaches/[id]` | refresh | UPDATE (description/remediation/cnilCaseNumber chiffrés) · audit UPDATE |
| **Transition FSM** | `POST /api/admin/data-breaches/[id]/transition` | dialog → refresh | UPDATE status + timestamp (cnil/users/closed) · audit (kind notify.cnil/notify.users/close) · **step-up MFA** + `Idempotency-Key` |

```gherkin
Feature: Transitions d'une violation (FSM)

  Scénario: notifier la CNIL (avec MFA fraîche)
    Étant donné une violation au statut "under_assessment" et une MFA fraîche
    Quand je transitionne vers "notified_cnil"
    Alors le statut passe à "notified_cnil"
    # Effet base: UPDATE data_breach(status, cnil_notified_at=now) + audit(kind=notify.cnil)

  Scénario: transition interdite par la FSM
    Étant donné une violation au statut "draft"
    Quand je tente la transition vers "notified_users"
    Alors la réponse est 409 "invalidTransition"
    # Effet base: AUCUNE modif

  Scénario: transition sans MFA récente
    Étant donné une MFA non récente (> fenêtre critique)
    Quand je tente une transition
    Alors la réponse est 401 (step-up requis)
```

**Cas limites** : transition interdite → 409 ; MFA absente/expirée → 401 ; édition bloquée si `closed` ; rétention 10 ans (CGI) — purge hors-scope UI.

---

## Écran : Liste factures (`/admin/invoices`) 🟢

**Statut impl.** : 🟢 Réel (pagination cursor, V1.5).

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Factures » + filtre statut (draft/issued/paid/cancelled/refunded) + Actualiser | visible |
| Ligne facture | numéro (ou « Brouillon #id »), badge statut, montant TTC, date émise, patient#/cabinet# |
| États | vide « Aucune facture », erreur, **alerte « > 100 factures, affiner le filtre »** si pagination |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Filtrer / actualiser | `GET /api/billing/invoices?status&limit&cursor` | liste paginée | **lecture** · audit (INVOICE) |
| Clic facture | — | `/admin/invoices/{id}` | aucun |

---

## Écran : Détail facture + PDF (`/admin/invoices/[id]`) 🟢

**Statut impl.** : 🟢 Réel (génération PDF + S3, IBAN chiffré).

### Affichage attendu

| Élément | État attendu |
|---|---|
| Fil d'Ariane + en-tête (numéro, badges statut/pays) | visible |
| Section PDF | si draft : « PDF dispo seulement pour les factures émises » · sinon : « Régénérer PDF » + « Télécharger PDF » |
| Détails (cabinet, patient, devise, pays, mode paiement, dates, créateur) | visible |
| Lignes (Description, Qté, Prix HT, TVA %, Total TTC) + totaux (sous-total/TVA/TTC) | visible |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Charger | `GET /api/billing/invoices/[id]` | détail | lecture · audit READ (contrôle d'accès interne) |
| Générer/Régénérer PDF | `POST /api/billing/invoices/[id]/pdf` | « PDF généré » | render PDF + upload **S3** + `pdfHash` (idempotent) · audit |
| Télécharger PDF | `GET /api/billing/invoices/[id]/pdf` | téléchargement `invoice-{id}.pdf` | stream S3 (Content-Disposition RFC 6266, X-Content-SHA256, ANSSI) |

```gherkin
Feature: Facture PDF

  Scénario: générer puis télécharger le PDF d'une facture émise
    Étant donné que je suis connecté en tant que "ADMIN"
    Et une facture au statut "issued"
    Quand je clique "Régénérer PDF"
    Alors je vois "PDF généré"
    # Effet base: render PDF + upload S3 + pdfHash (idempotent) + audit
    Quand je clique "Télécharger PDF"
    Alors le navigateur télécharge "invoice-{id}.pdf"

  Scénario: PDF indisponible pour un brouillon
    Étant donné une facture au statut "draft"
    Quand j'ouvre son détail
    Alors je vois "Le PDF n'est disponible que pour les factures émises"
```

**Cas limites** : IBAN chiffré AES-256 (échec déchiffrement → `renderFailed`) ; race de génération concurrente (`concurrentGenerationRaceLost`) ; rétention 10 ans CGI.

---

## Écran : Règles fiscales / TVA (`/admin/tax-rules`) 🟢

**Statut impl.** : 🟢 Réel en **lecture seule** (création/édition via runbook). Backend lecture = NURSE+.

### Affichage attendu

| Élément | État attendu |
|---|---|
| Titre « Règles fiscales » + mention « Lecture seule » | visible |
| Formulaire : Pays (ISO alpha-2, datalist), Type de taxe (VAT / IR / IS / cotisation), Date (défaut aujourd'hui) | visible |
| Résultat | « Aucun taux actif… » OU grand % + détails (pays, type, taux, statut, effet depuis/jusqu'au, description) |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Rechercher taux actif | `GET /api/config/tax-rules/active?countryCode&taxType&date` | affiche le taux ou 404 | **lecture seule** · audit READ (COUNTRY_TAX_RULE, `found:bool`) |

```gherkin
Feature: Résolution d'un taux fiscal actif

  Scénario: taux de TVA français à une date donnée
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand je recherche le taux "VAT" pour "FR" au "2026-06-05"
    Alors je vois le taux actif en pourcentage
    # Effet base: lecture seule + audit(READ/COUNTRY_TAX_RULE, found=true)

  Scénario: aucun taux actif
    Quand je recherche un pays/type sans règle active
    Alors je vois "Aucun taux actif"
    # Effet base: 404 noActiveRule (countryCode/taxType/atDate inclus pour rejeu)
```

**Cas limites** : code pays libre (validé regex `^[A-Z]{2}$`) ; date locale (pas UTC, évite « demain par défaut »).
