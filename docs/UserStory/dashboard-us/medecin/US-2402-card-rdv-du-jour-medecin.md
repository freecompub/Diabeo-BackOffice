# US-2402 — Card RDV du jour (médecin)

> 📌 **medecin** · Priorité **MVP** · Satellite de `US-2400`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2402` |
| **Type** | Composant satellite |
| **Priorité** | **MVP** |
| **Story points** | **5** |
| **Persona** | DOCTOR, NURSE |
| **Dépendances** | US-2070 (calendrier RDV), US-2071 (détail RDV), US-2400 |
| **US parente** | `US-2400` |

---

## 📋 Contexte produit

Card affichant les RDV du jour du médecin. Vue compacte avec horaires, patients et contextes (pathologie, mode). Tap sur un RDV ouvre le détail ou la fiche patient. Mise à jour à chaque création/modification de RDV.

---

## 🎨 Composition

### Layout
- Header : icône calendar + 'RDV du jour · N'
- Liste verticale RDV jour, triés chronologiquement
- Chaque RDV (1 ligne) :
  - Pill horaire (couleur active pour RDV imminent <30min)
  - Nom patient + pathologie / contexte
- Footer si plus de 3 RDV : '+ X autres RDV'
- CTA 'Voir agenda complet'

### Mise à jour
- Polling toutes les 5 min (pas besoin temps réel pour les RDV)
- Refresh manuel sur action utilisateur

---

## ✅ Critères d'acceptation

### AC-1 — Liste RDV jour
```gherkin
Étant donné médecin a 7 RDV aujourd'hui
Quand consulte le dashboard
Alors 3 prochains visibles, '+ 4 autres'
```

### AC-2 — RDV imminent <30min
```gherkin
Étant donné RDV dans 15 min
Quand card se rend
Alors pill horaire en couleur active (teal) pour signaler
```

### AC-3 — Tap RDV → détail
```gherkin
Étant donné médecin clique RDV
Quand il valide
Alors détail RDV s'ouvre (US-2071)
```

### AC-4 — Tri chronologique
```gherkin
Étant donné 5 RDV
Quand se rendent
Alors triés par horaire croissant
```

### AC-5 — Empty state
```gherkin
Étant donné aucun RDV jour
Quand médecin consulte
Alors 'Aucun RDV aujourd'hui' avec CTA 'Planifier'
```

### AC-6 — MAJ après création
```gherkin
Étant donné secrétaire ajoute un RDV
Quand polling déclenche
Alors nouveau RDV apparaît dans la liste en <5min
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Polling 5 min suffit (pas de WebSocket nécessaire)
- **RM-2** : Max 3 RDV visibles avec CTA 'Voir agenda complet'
- **RM-3** : RDV imminent <30min en couleur active pour attirer l'attention
- **RM-4** : Mode visio (V4) : icône caméra à côté du RDV

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/medecin/rdv-today
  → liste RDV jour triée chronologiquement
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | Liste RDV affichée |
| Empty | 'Aucun RDV aujourd'hui' + CTA planifier |
| RDV imminent | Pill couleur active |
| Loading | Skeleton 3 lignes |

---

## 🧪 Tests prioritaires

- **Tri chronologique** : valider ordre
- **RDV imminent** : tester avec RDV dans 5/15/30min
- **Polling** : valider rafraîchissement 5 min
- **Empty state** : valider message + CTA

---

## 📦 DoD dashboard-spécifique

- [ ] Liste RDV correctement triée
- [ ] RDV imminent visuellement signalé
- [ ] Polling fonctionnel
- [ ] Navigation vers détail RDV OK

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2400
- US liées : US-2070, US-2071

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
