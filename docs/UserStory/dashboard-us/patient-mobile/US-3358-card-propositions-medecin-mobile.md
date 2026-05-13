# US-3358 — Card propositions médecin (mobile)

> 📌 **patient-mobile** · Priorité **MVP** · Satellite de `US-3355`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-3358` |
| **Type** | Composant satellite |
| **Priorité** | **MVP** |
| **Story points** | **5** |
| **Persona** | Patient (📱 iOS + Android) |
| **Dépendances** | US-3113 (inbox propositions), US-3114 (détail proposition), US-3355 |
| **US parente** | `US-3355` |

---

## 📋 Contexte produit

Card affichée sur le dashboard mobile **uniquement si une proposition est en attente**. Position prioritaire (juste sous la glycémie), couleur ambre distinctive pour attirer l'attention sans paniquer. Tap = ouvre l'écran détail avec accept/refuse/préciser.

Sur mobile, geste rapide = peu de boutons directs depuis la card, juste un CTA vers le détail.

---

## 🎨 Composition

### Layout
- Background ambre clair (#FAEEDA)
- Bordure gauche ambre foncée (#BA7517) 3px
- Icône clipboard-list + libellé 'Nouvelle proposition de Dr [nom]'
- Description courte (1 ligne) : 'Ajustement ratio IC du midi'
- Chevron droite (tap pour détail)
- Tap-target full-card

### Animation
- Apparition slide-down quand nouvelle proposition arrive (foreground)
- Pulse léger 1× pour attirer l'attention

---

## ✅ Critères d'acceptation

### AC-1 — Card cachée si 0 proposition
```gherkin
Étant donné patient n'a aucune proposition
Quand il ouvre le dashboard
Alors card NON affichée (pas d'empty state inutile)
```

### AC-2 — Card affichée si proposition
```gherkin
Étant donné 1 proposition en attente
Quand patient ouvre dashboard
Alors card apparaît en position 2 (sous glycémie) avec couleur ambre
```

### AC-3 — Tap ouvre détail
```gherkin
Étant donné card affichée
Quand patient tape dessus
Alors navigation vers détail proposition (US-3114)
```

### AC-4 — Plusieurs propositions
```gherkin
Étant donné 2+ propositions en attente
Quand patient ouvre dashboard
Alors card indique 'X propositions en attente', tap → liste
```

### AC-5 — Notification associée
```gherkin
Étant donné nouvelle proposition arrive
Quand patient ouvre app suite à push
Alors card mise en avant avec animation
```

### AC-6 — Vibration sur arrivée
```gherkin
Étant donné nouvelle proposition pendant utilisation
Quand device la reçoit
Alors vibration medium + pulse card
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Card cachée si 0 proposition (pas d'empty state inutile)
- **RM-2** : Limite 1 card visible même si plusieurs propositions (libellé 'X propositions')
- **RM-3** : Card disparaît automatiquement après acceptation/refus/expiration
- **RM-4** : Couleur ambre attire l'attention sans paniquer (vs rouge urgences)

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/patient/me/proposals?status=pending
  → propositions en attente

PATCH /api/patient/me/proposals/[id]/seen
  → marquer comme vue (réduction badge)
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| 0 proposition | Card cachée |
| 1 proposition | Card avec aperçu et CTA |
| 2+ propositions | Card 'X propositions en attente' |
| Loading | Pas de skeleton (card invisible par défaut) |

---

## 🧪 Tests prioritaires

- **Présence conditionnelle** : 0 proposition → absente, 1+ → présente
- **Multi-propositions** : 2+ → libellé adapté
- **Animation arrivée** : nouvelle proposition pendant utilisation → slide-down + pulse
- **Navigation** : tap → écran détail correct

---

## 📦 DoD dashboard-spécifique

- [ ] Card conditionnelle testée (0, 1, 2+ propositions)
- [ ] Animation slide-down + pulse fonctionnelle
- [ ] Navigation correcte vers détail
- [ ] Vibration haptique testée

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-3355
- US liées : US-3113, US-3114

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
