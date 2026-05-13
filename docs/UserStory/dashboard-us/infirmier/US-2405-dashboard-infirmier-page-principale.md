# US-2405 — Dashboard infirmier (page principale)

> 📌 **infirmier** · Priorité **V1**

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2405` |
| **Type** | Page composite |
| **Priorité** | **V1** |
| **Story points** | **8** |
| **Persona** | NURSE (🖥️ Web ≥1024px) |
| **Dépendances** | US-2001 (login), US-2011 (audit), US-2012 (RBAC NURSE), US-2406 (KPI ma journée), US-2407 (to-do), US-2408 (coordination équipe), US-2409 (relances) |

---

## 📋 Contexte produit

Dashboard spécifique au rôle NURSE — fondamentalement différent du dashboard médecin. Centré sur **'Ma journée'** (vue type todo-list opérationnelle) plutôt que sur la supervision clinique. L'infirmier prépare les consultations, relance les patients en non-saisie, saisit les mesures, coordonne avec les médecins. Sessions longues continues (toute la journée).

Cf prototype interactif « Dashboard infirmier » et écran SCR-116 (à ajouter).

---

## 🎨 Composition

### KPI 'Ma journée' (4 chiffres en haut)
- RDV à préparer · Patients à relancer · Mesures à saisir · Avant 12h
- Source : US-2406

### Zone principale (3/5 + 2/5)

**Gauche : To-do du jour (3/5)**
- Liste type checkbox triée par urgence + horaire
- Source : US-2407

**Droite : Coordination équipe (2/5)**
- Messages reçus des médecins / soignants
- Source : US-2408

### Zone basse : Relances en attente
- Cards patients avec actions Appeler/SMS directes
- Source : US-2409

### Sidebar avec accent NURSE
- Ma journée (actif), Patients, RDV, Messages, Relances (badge)
- Pas d'accès à Analytics (RBAC NURSE)

---

## ✅ Critères d'acceptation

### AC-1 — Composition centrée 'Ma journée'
```gherkin
Étant donné infirmier connecté
Quand il ouvre le dashboard
Alors le bloc 'Ma journée' (4 KPI) en haut, to-do au centre, coordination à droite
```

### AC-2 — To-do triée par urgence
```gherkin
Étant donné l'infirmier consulte la to-do
Quand la liste se charge
Alors items triés par urgence (badge 'Urgent' en haut) puis par horaire
```

### AC-3 — RBAC NURSE respecté
```gherkin
Étant donné NURSE charge le dashboard
Quand il consulte les options
Alors pas de bouton 'Créer proposition d'ajustement' (réservé DOCTOR), pas d'accès Analytics
```

### AC-4 — Coordination équipe en lecture
```gherkin
Étant donné médecin a envoyé un message
Quand NURSE charge le dashboard
Alors le message apparaît dans Coordination équipe en haut
```

### AC-5 — Relances actionnables direct
```gherkin
Étant donné 5 patients à relancer
Quand NURSE consulte les cards
Alors boutons Appeler et SMS directement actionnables
```

### AC-6 — Sync avec médecin référent
```gherkin
Étant donné NURSE complète une tâche
Quand il coche la checkbox
Alors médecin référent reçoit notification dans son drawer
```

### AC-7 — Vue partagée multi-médecins
```gherkin
Étant donné NURSE travaille pour 2 médecins
Quand il charge le dashboard
Alors to-do mélange les patients des 2 médecins, badge référent visible
```

---

## 📐 Règles métier spécifiques

- **RM-1** : NURSE voit les patients des médecins qu'il assiste (HealthcareMember)
- **RM-2** : Actions cliniques sensibles (ajustement, proposition) désactivées avec tooltip 'Réservé aux médecins'
- **RM-3** : Cache Redis to-do TTL 60s (rafraîchissement fréquent)
- **RM-4** : Coordination équipe utilise un canal de messagerie interne distinct de la messagerie patient
- **RM-5** : Cochage d'une checkbox = action immédiate + notification médecin référent
- **RM-6** : Couleur dominante violet #7F77DD pour distinguer du dashboard médecin

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/infirmier
  → { kpiDay, todoList, teamMessages, recallList }

PATCH /api/dashboard/infirmier/todo/[id]/complete
  → { task, notifySent: true }

GET /api/team/messages?recipient=me
  → messages internes équipe
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | KPI + to-do + coordination + relances affichés |
| To-do vide | 'Aucune tâche pour le moment, profitez-en !' |
| Coordination vide | 'Aucun nouveau message équipe' |
| Relances vides | 'Tous les patients sont à jour, bravo !' |
| RBAC restrictif | Actions cliniques désactivées |
| Multi-médecins | Badge médecin référent par item |

---

## 🧪 Tests prioritaires

- **RBAC NURSE** : actions cliniques bloquées, accès Analytics refusé
- **Vue multi-médecins** : tests avec NURSE assistant 2-3 médecins
- **Notification médecin** : completion task → notification reçue côté médecin
- **Performance** : to-do 50 items rendue < 500ms
- **Actions directes** : boutons Appeler/SMS déclenchent les bons workflows

> Plan de test détaillé dans `docs/testing/baseline.md`.

---

## 📦 DoD dashboard-spécifique

- [ ] RBAC NURSE strictement appliqué et testé
- [ ] Vue multi-médecins fonctionnelle
- [ ] Boutons Appeler/SMS opérationnels (intégration téléphonie)
- [ ] Notifications médecin déclenchées sur completion task
- [ ] Performance to-do 50 items <500ms
- [ ] Validation produit avec un infirmier réel

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- Cartographie écran : SCR-116 (Dashboard infirmier — à ajouter)
- Prototype : Dashboard infirmier
- US satellites : US-2406, US-2407, US-2408, US-2409

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
