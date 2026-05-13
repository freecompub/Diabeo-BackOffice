# US-2270 — Card patients à suivre (médecin)

> 📌 **medecin** · Priorité **MVP** · Satellite de `US-2265`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2270` |
| **Type** | Composant satellite |
| **Priorité** | **MVP** |
| **Story points** | **8** |
| **Persona** | DOCTOR, NURSE |
| **Dépendances** | US-2076 (algorithme détection patients à risque), US-2018 (fiche patient), US-2265 |
| **US parente** | `US-2265` |

---

## 📋 Contexte produit

Card affichant les patients identifiés par algorithme comme nécessitant un suivi proactif (hors urgences). Critères : hypos répétées, non-saisie prolongée, TIR en baisse, propositions non acceptées, etc. Cible : permettre au médecin d'identifier les patients fragiles avant qu'ils deviennent des urgences.

Distinct de la card urgences (temps réel critique).

---

## 🎨 Composition

### Layout
- Header : icône user-exclamation + 'Patients à suivre · N'
- Grille 3 colonnes (3 cards patients visibles)
- Chaque patient :
  - Avatar initiales colorées selon criticité
  - Nom + pathologie
  - Motif principal (3 hypos cette semaine, non-saisie 7j, etc.)
  - Métrique secondaire (TIR 52% ↓)
- CTA 'Voir tous' → page liste filtrée

### Algorithme priorisation
- Hypos répétées (3+ en 7 jours) : haute priorité
- Non-saisie 5j+ : moyenne priorité
- TIR en baisse > 10pts en 14j : moyenne priorité
- Propositions refusées sans motif : basse priorité

---

## ✅ Critères d'acceptation

### AC-1 — Liste patients à suivre
```gherkin
Étant donné médecin a 12 patients à suivre identifiés
Quand consulte le dashboard
Alors 3 cards prioritaires visibles, CTA '+ 9 autres'
```

### AC-2 — Tri priorité
```gherkin
Étant donné patients avec criticités différentes
Quand se rendent
Alors tri : hypos répétées → non-saisie → TIR baisse → propositions refusées
```

### AC-3 — Motif explicite
```gherkin
Étant donné patient identifié pour non-saisie
Quand card se rend
Alors motif visible : 'Non-saisie 7j' (orange)
```

### AC-4 — Tap → fiche patient
```gherkin
Étant donné médecin clique un patient
Quand il valide
Alors fiche patient s'ouvre (US-2018)
```

### AC-5 — Empty state
```gherkin
Étant donné aucun patient à suivre
Quand consulte la card
Alors 'Tous vos patients sont stables' (vert)
```

### AC-6 — Rafraîchissement
```gherkin
Étant donné algorithme tourne quotidiennement la nuit
Quand médecin charge le matin
Alors liste mise à jour avec les nouveaux candidats
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Algorithme tourne 1x/jour à 3h du matin (batch nocturne)
- **RM-2** : Score de criticité : pondération des critères (hypos répétées x3, non-saisie x2, etc.)
- **RM-3** : Filtrage par périmètre médecin (referentId)
- **RM-4** : Max 3 cards visibles + CTA, page dédiée pour liste complète
- **RM-5** : Exclusion : patients déjà en urgence active (déjà visible dans card urgences)

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/medecin/patients-at-risk
  → patients triés par criticité

GET /api/dashboard/medecin/patients-at-risk/all
  → page complète avec filtres
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | 3 cards prioritaires |
| Empty | 'Tous vos patients sont stables' (vert) |
| Loading | Skeleton 3 cards |

---

## 🧪 Tests prioritaires

- **Algorithme priorisation** : valider tri avec dataset connu
- **Périmètre patient** : test exclusion patients hors portefeuille
- **Exclusion urgences** : valider qu'un patient en urgence n'apparaît pas ici
- **Batch nocturne** : valider exécution scheduled job
- **Navigation** : tap → fiche patient correct

---

## 📦 DoD dashboard-spécifique

- [ ] Algorithme priorisation validé par PO/médecin
- [ ] Batch nocturne planifié et testé
- [ ] Périmètre patient strict
- [ ] Exclusion urgences active fonctionnelle
- [ ] Empty state rassurant

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2265
- US liées : US-2076, US-2018

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
