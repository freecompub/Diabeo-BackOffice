# US-2409 — Relances en attente (infirmier)

> 📌 **infirmier** · Priorité **V1** · Satellite de `US-2405`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2409` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **5** |
| **Persona** | NURSE |
| **Dépendances** | US-2800 (algorithme détection patients à risque, V4), US-2405 |
| **US parente** | `US-2405` |

---

## 📋 Contexte produit

Section en bas du dashboard infirmier avec les patients à relancer (non-saisie, RDV non confirmé, ordo à renouveler). Actions directes Appeler / SMS depuis chaque card pour gain de temps maximal — pas besoin de naviguer vers la fiche patient pour appeler.

---

## 🎨 Composition

### Layout
- Header : icône phone + 'Relances en attente · N'
- CTA 'Lancer toutes les relances'
- Grille 3 colonnes (3 cards visibles)
- Chaque card :
  - Avatar initiales colorées selon motif
  - Nom patient + âge + pathologie
  - Motif (Non-saisie 7j, RDV non confirmé, Ordo à renouveler)
  - 2 boutons : Appeler · SMS

### Workflow boutons
- Appeler : ouvre tel:+33... dans le navigateur (Mac OS et Windows)
- SMS : ouvre modal envoi SMS via service tiers (Twilio)
- Action enregistrée → tâche disparaît de la liste

---

## ✅ Critères d'acceptation

### AC-1 — Liste relances
```gherkin
Étant donné infirmier a 5 patients à relancer
Quand consulte le dashboard
Alors 3 cards prioritaires visibles, '+ 2 autres'
```

### AC-2 — Bouton Appeler
```gherkin
Étant donné infirmier clique 'Appeler' sur une card
Quand il valide
Alors lien tel:+33... s'ouvre dans le navigateur
```

### AC-3 — Bouton SMS
```gherkin
Étant donné infirmier clique 'SMS'
Quand il valide
Alors modal envoi SMS s'ouvre (avec template pré-rempli selon motif)
```

### AC-4 — Card disparaît après action
```gherkin
Étant donné infirmier envoie un SMS
Quand action enregistrée
Alors card disparaît de la liste (animation fade-out)
```

### AC-5 — Lancer toutes les relances
```gherkin
Étant donné infirmier clique CTA en haut
Quand il valide
Alors modal de confirmation avant envoi en lot
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Bouton Appeler ouvre tel: URI navigateur (pas d'intégration téléphonie complexe MVP)
- **RM-2** : SMS via Twilio (avec template par motif)
- **RM-3** : Action enregistrée → patient retiré de la liste (jusqu'au prochain check algorithme)
- **RM-4** : AuditLog : trace de l'appel/SMS pour traçabilité

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/infirmier/recall-list
  → liste patients à relancer

POST /api/dashboard/infirmier/recall/[patientId]/sms
  → { template, customMessage } → envoi SMS

POST /api/dashboard/infirmier/recall/[patientId]/log-call
  → enregistrement appel téléphonique
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | 3 cards visibles |
| Empty | 'Tous les patients sont à jour, bravo !' (vert) |
| Action en cours | Spinner sur card pendant envoi SMS |
| Card disparaît | Animation fade-out après action |

---

## 🧪 Tests prioritaires

- **Bouton Appeler** : valider ouverture tel: URI
- **Bouton SMS** : valider envoi via Twilio
- **Disparition card** : valider animation après action
- **Templates SMS** : valider templates par motif
- **AuditLog** : trace appel/SMS

---

## 📦 DoD dashboard-spécifique

- [ ] Tel: URI fonctionnel cross-browser
- [ ] Intégration Twilio configurée
- [ ] Templates SMS validés par PO
- [ ] AuditLog enregistré pour chaque action
- [ ] Empty state encourageant

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2405
- US liée : US-2800 (V4)

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
