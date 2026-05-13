# US-2273 — To-do du jour avec checkboxes (infirmier)

> 📌 **infirmier** · Priorité **V1** · Satellite de `US-2266`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2273` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **8** |
| **Persona** | NURSE |
| **Dépendances** | US-2070, US-2266 |
| **US parente** | `US-2266` |

---

## 📋 Contexte produit

Composant central du dashboard infirmier — liste des tâches du jour avec checkboxes interactives. Triées par urgence (badge 'Urgent' en haut) puis par horaire. Cochage = action immédiate + notification au médecin référent. Sessions longues (toute la journée) donc UX optimisée pour cocher beaucoup et vite.

---

## 🎨 Composition

### Layout
- Header : icône checkup-list + 'Ma to-do du matin' + compteur '7/15'
- Liste verticale, scrollable
- Chaque item :
  - Checkbox (cocher = action immédiate)
  - Badge horaire (couleur active si <1h, gris sinon, 'Urgent' si urgent, 'Fait' si terminé)
  - Description tâche + contexte patient en gris
  - Chevron droite (tap = voir détail)
- Items 'Fait' barrés et grisés
- Footer : '+ X autres tâches'

### Types de tâches
- Préparer dossier patient (avant RDV)
- Appeler patient (relance non-saisie, RDV non confirmé)
- Saisir mesures pré-consultation
- Confirmer renouvellement ordonnance
- Coordonner avec médecin pour décision

### Tri
1. Items urgents en haut
2. Items avec horaire < 1h
3. Items chronologiques
4. Items 'Fait' en bas

---

## ✅ Critères d'acceptation

### AC-1 — Liste tâches du jour
```gherkin
Étant donné infirmier a 15 tâches
Quand consulte le dashboard
Alors 5 tâches prioritaires visibles + footer '+ 10 autres'
```

### AC-2 — Tri par urgence puis horaire
```gherkin
Étant donné items mélangés
Quand se rendent
Alors urgents en haut, puis chronologique
```

### AC-3 — Cocher = action + notification
```gherkin
Étant donné infirmier coche une tâche 'Confirmer RDV'
Quand il valide
Alors tâche barrée + notification envoyée au médecin référent
```

### AC-4 — Décocher = annulation
```gherkin
Étant donné infirmier décoche par erreur
Quand il valide
Alors tâche revient à l'état actif, notification annulée si <30s
```

### AC-5 — Tap chevron = détail
```gherkin
Étant donné infirmier clique chevron
Quand il valide
Alors écran détail tâche ou fiche patient s'ouvre
```

### AC-6 — Badge 'Urgent'
```gherkin
Étant donné tâche marquée urgente
Quand se rend
Alors badge orange 'Urgent' visible
```

### AC-7 — Multi-médecins
```gherkin
Étant donné NURSE assistant 2 médecins
Quand consulte la to-do
Alors tâches mélangées, badge médecin référent visible par item
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Cochage = appel API immédiat (PATCH /todo/[id]/complete)
- **RM-2** : Notification médecin référent envoyée 30s après cochage (window d'annulation)
- **RM-3** : Tri stable : items 'Fait' restent en place pour ne pas désorienter
- **RM-4** : Multi-médecins : badge référent obligatoire pour clarté
- **RM-5** : Performance : 50 items rendus <500ms (virtualisation si >100)

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/infirmier/todo
  → liste tâches jour triées

PATCH /api/dashboard/infirmier/todo/[id]/complete
  → { task, notifySent: true }

PATCH /api/dashboard/infirmier/todo/[id]/uncomplete
  → annulation (window 30s)
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | Liste tâches avec checkboxes |
| Item coché | Barré + grisé |
| Item urgent | Badge orange + bordure |
| Loading | Skeleton 5 items |
| Empty | 'Aucune tâche pour le moment' (encourageant) |

---

## 🧪 Tests prioritaires

- **Cochage** : valider notification médecin (E2E)
- **Décochage <30s** : valider annulation notification
- **Tri** : valider ordre avec items mélangés
- **Multi-médecins** : badge référent affiché
- **Performance** : 50 items <500ms

---

## 📦 DoD dashboard-spécifique

- [ ] Cochage déclenche notification médecin
- [ ] Fenêtre d'annulation 30s testée
- [ ] Tri stable validé
- [ ] Multi-médecins testé
- [ ] Performance 50 items validée

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2266

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
