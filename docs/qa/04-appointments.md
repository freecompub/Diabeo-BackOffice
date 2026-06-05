# QA — Rendez-vous (calendrier)

Écran : `/appointments` (Schedule-X v4). Voir [conventions](README.md#3-conventions--légende).

> Écran déjà partiellement couvert par les tests manuels :
> `tests/manual/appointments-{create,detail-modal,view-switch,time-axis}.spec.ts`.
> Cycle de vie d'un RDV : `scheduled` / `pending_validation` → `confirmed` →
> `completed` ; ou `cancelled` (→ `proposed alternative` → `scheduled`) ; ou `no_show`.

---

## Écran : Calendrier RDV (`/appointments`) 🟢

**Rôle / RBAC** : NURSE+. VIEWER redirigé vers son home. **« Proposer
alternative » visible DOCTOR+ uniquement** (caché pour NURSE).
**Statut impl.** : 🟢 Réel (`/api/appointments` + actions `[id]/{confirm,cancel,propose-alternative,accept-alternative}` + `PUT /api/appointments/[id]`).

### Affichage attendu

| Élément | État attendu |
|---|---|
| Vue calendrier | Semaine / Mois / Jour via sélecteur Schedule-X |
| Axe horaire (vue Semaine) | 24 libellés `00 h` → `23 h`, ordonnés (locale fr-FR) |
| Couleur des événements | par statut (scheduled = vert, pending_validation = gris, confirmed = teal, cancelled/no_show = rouge, completed = gris) |
| Bouton « + Nouveau RDV » | visible NURSE+ |
| Filtres | Membre cabinet (auto-résolu si 1 seul), Patient (optionnel), Statut (multi-select client, défaut scheduled/pending_validation/confirmed) |
| Compteur | « N RDV » |
| États | chargement (spinner), erreur « Erreur lors du chargement du calendrier », plage vide |
| A11y | skip-link vers le calendrier |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Changer de vue (Semaine/Mois/Jour) | — (client) | re-layout | aucun |
| Filtrer (membre / patient / statut) | re-`GET /api/appointments?from&to&memberId&patientId` | calendrier re-fetch | aucun (filtre de requête) |
| **Créer un RDV** | `POST /api/appointments` | modal se ferme, toast **« ✓ Rendez-vous créé avec succès »**, événement vert apparaît | INSERT `appointments` (`motifEncrypted` AES-256-GCM, `status` selon `bookingMode`) · audit CREATE/APPOINTMENT |
| Ouvrir le détail (clic événement) | `GET /api/appointments/[id]` | modal détail (motif/note déchiffrés) | lecture |
| **Confirmer** (pending_validation) | `POST /api/appointments/[id]/confirm` | badge passe en teal | UPDATE `status='confirmed'`, `proposedAlternativeAt=NULL` · audit |
| **Annuler** | `POST /api/appointments/[id]/cancel` | badge rouge, raison enregistrée | UPDATE `status='cancelled'`, `cancelledBy`, `cancelReasonEncrypted`, `cancelledAt`, flag `lateCancel` (<24 h) · audit |
| **Proposer alternative** (DOCTOR, après annulation médecin) | `POST /api/appointments/[id]/propose-alternative` | bannière « Alternative proposée » (TTL 7 j) | UPDATE `proposedAlternativeAt` · audit |
| **Accepter alternative** | `POST /api/appointments/[id]/accept-alternative` | RDV repasse vert (scheduled) | UPDATE `status='scheduled'`, nouvelle date/heure, reset champs annulation · audit |
| **Déplacer (drag & drop)** | `PUT /api/appointments/[id]` | événement saute au nouveau créneau | UPDATE `date/hour/durationMinutes`, `proposedAlternativeAt=NULL` · audit |

> Validation création (Zod) : `patientId>0`, `memberId>0`, `date` `YYYY-MM-DD`,
> `hour` `HH:MM`, `durationMinutes ∈ [15,240]` (défaut 30), `location ∈
> {in_person,video,phone}`, `type ≤ 50`, `motif ≤ 200`. **Anti-chevauchement**
> en transaction **Serializable** (`assertNoOverlap` sur statuts actifs du même
> `memberId`). Date/heure dans le futur (contrôle client + serveur).

### Scénarios (Gherkin)

```gherkin
Feature: Gestion des rendez-vous

  Background:
    Given je suis connecté en tant que "DOCTOR"
    And je suis sur "/appointments"
    And le calendrier est monté

  Scenario: changer la vue du calendrier
    When je change la vue pour "Mois"
    Then la grille mensuelle est affichée
    # Effet base: AUCUN (état client)

  Scenario: l'axe horaire de la vue Semaine affiche 24 heures ordonnées
    When je sélectionne la vue "Semaine"
    Then l'axe horaire affiche 24 libellés de "00 h" à "23 h" en ordre croissant
    # (anti-régression réactivité Schedule-X / format locale fr-FR)

  Scenario: créer un nouveau rendez-vous
    When je clique "+ Nouveau RDV"
    And je sélectionne le patient "Jean Durand #1"
    And je choisis une date et une heure futures uniques
    And je saisis le motif "Contrôle trimestriel"
    And je clique "Créer le RDV"
    Then la réponse de POST "/api/appointments" est 201
    And la modale se ferme
    And je vois "✓ Rendez-vous créé avec succès"
    # Effet base: INSERT appointments(motifEncrypted, status=scheduled|pending_validation)
    #             + audit_logs(action=CREATE, resource=APPOINTMENT, metadata.patientId)

  Scenario: créneau déjà pris (double-booking)
    When je crée un RDV sur un créneau déjà occupé pour le même membre
    Then la réponse est 409
    And je vois un message indiquant que le créneau est occupé
    # Effet base: AUCUNE insertion (transaction Serializable rejette le chevauchement)

  Scenario: annuler un rendez-vous avec motif
    Given un RDV "scheduled" existe
    When j'ouvre son détail et je clique "Annuler"
    And je choisis l'acteur "doctor" et la raison "Indisponibilité"
    And je confirme l'annulation
    Then le badge du RDV passe à "cancelled"
    # Effet base: UPDATE appointments(status=cancelled, cancelledBy=doctor,
    #             cancelReasonEncrypted, cancelledAt) + audit_logs(kind=cancel, lateCancel)

  Scenario: proposer puis accepter une alternative
    Given un RDV annulé par le médecin
    When je propose une alternative à une date/heure future
    Then le patient voit "Alternative proposée"
    # Effet base: UPDATE appointments(proposedAlternativeAt) + audit
    When le patient accepte l'alternative
    Then le RDV repasse en "scheduled" à la nouvelle date
    # Effet base: UPDATE appointments(status=scheduled, date, hour,
    #             proposedAlternativeAt=NULL, cancelledBy=NULL) + audit(kind=accept-alternative)

  Scenario: le bouton "Proposer alternative" est caché pour un NURSE
    Given je suis connecté en tant que "NURSE"
    And j'ouvre le détail d'un RDV annulé par le médecin
    Then je ne vois pas le bouton "Proposer alternative"
    # (l'API renverrait 403 — bouton masqué côté UI par défense en profondeur)

  Scenario: création bloquée si le patient a retiré son consentement
    Given un patient sans consentement de partage
    When je tente de créer un RDV pour ce patient
    Then la réponse est 422 "gdprConsentRequired"
    # Effet base: AUCUNE insertion
```

### Cas limites

- **Double-booking (409)** : isolation Serializable, 1er commit gagne, message
  « créneau occupé ».
- **Accès non autorisé (403)** : RDV d'un patient hors périmètre → audit
  `accessDenied`.
- **Consentement RGPD manquant (422)** à la création.
- **Alternative expirée (422)** : > 7 j (`PROPOSAL_TTL_MS`).
- **Créneau occupé entre propose et accept (409)** : race tracée en audit.
- **Mode `validation`** (`member.bookingMode`) : RDV créé en
  `pending_validation`, n'apparaît au patient qu'après confirmation.
- **Idempotence des tests d'écriture** : utiliser un créneau futur unique par
  run (cf. correctif de la spec manuelle `appointments-create`).
