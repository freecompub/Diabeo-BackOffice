# US-3359 — FAB central — Quick actions (mobile)

> 📌 **patient-mobile** · Priorité **MVP** · Satellite de `US-3355`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-3359` |
| **Type** | Composant satellite |
| **Priorité** | **MVP** |
| **Story points** | **5** |
| **Persona** | Patient (📱 iOS + Android) |
| **Dépendances** | US-3044 (saisie glycémie), US-3062 (calculateur bolus), US-3078 (saisie repas), US-3355 |
| **US parente** | `US-3355` |

---

## 📋 Contexte produit

FAB (Floating Action Button) central persistant sur le dashboard mobile et 3 autres tabs (Glycémie, Journal, Communication). Position bottom-center comme une 5e tab visuelle mais c'est un bouton d'action. Tap = ouvre un bottom sheet avec 6 actions rapides.

En mode urgence active, le FAB se transforme en bouton 'Voir procédure'.

---

## 🎨 Composition

### FAB
- Position : bottom-center, intégré au bottom nav
- Forme : cercle 52×52px, surélevé (-28px)
- Couleur : teal primary #0D9488, shadow douce
- Icône : ti-plus (24pt blanc)

### Bottom sheet ouvert (6 actions)
- 💧 Saisir glycémie (US-3044)
- 🍽️ Ajouter repas (US-3078)
- 💉 Calculer bolus (US-3062)
- 🏃 Activité (US-3093)
- 📝 Note (US-3109)
- ⚠️ Hypo / Hyper (US-3104)
- Drag-to-dismiss + tap dehors = fermeture

### Long press 500ms
- Ouvre directement la dernière action utilisée (raccourci power user)

### Mode urgence active
- FAB transformé : icône ⚠️ rouge, libellé 'Voir procédure'
- Tap = ouvre directement la procédure en cours

---

## ✅ Critères d'acceptation

### AC-1 — FAB visible 4 tabs
```gherkin
Étant donné patient sur Accueil/Glycémie/Journal/Communication
Quand FAB visible
Alors il peut taper dessus pour ouvrir bottom sheet
```

### AC-2 — FAB caché sur Profil
```gherkin
Étant donné patient navigue vers tab Profil
Quand FAB non pertinent
Alors caché ou désactivé
```

### AC-3 — Bottom sheet 6 actions
```gherkin
Étant donné patient tape sur FAB
Quand bottom sheet s'ouvre
Alors 6 actions affichées avec icônes + labels
```

### AC-4 — Tap action déclenche écran
```gherkin
Étant donné patient choisit 'Saisir glycémie'
Quand il valide
Alors écran saisie s'ouvre (US-3044)
```

### AC-5 — Long press raccourci
```gherkin
Étant donné patient a utilisé 'Calculer bolus' en dernier
Quand long press FAB
Alors écran bolus s'ouvre directement (sans bottom sheet)
```

### AC-6 — Mode urgence active
```gherkin
Étant donné urgence hypo en cours
Quand patient regarde le FAB
Alors transformé en bouton 'Voir procédure' rouge, tap → procédure
```

### AC-7 — Drag-to-dismiss
```gherkin
Étant donné bottom sheet ouvert
Quand patient swipe vers le bas
Alors bottom sheet se ferme avec animation
```

### AC-8 — Adaptation Ramadan
```gherkin
Étant donné mode Ramadan période jeûne
Quand patient tape FAB
Alors action 'Ajouter repas' grisée avec tooltip 'En période de jeûne'
```

---

## 📐 Règles métier spécifiques

- **RM-1** : FAB persistant sauf mode urgence active (transformé) ou tab Profil (caché)
- **RM-2** : Long press déclenche dernière action utilisée (mémorisée préférences)
- **RM-3** : Adaptation mode contextuel : Ramadan grise 'Repas' en période de jeûne
- **RM-4** : Tap zone 48×48dp minimum (accessibilité)
- **RM-5** : Z-index supérieur au bottom nav mais inférieur aux modals

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

Pas d'API spécifique — composant pure UI qui navigue vers les écrans de saisie existants.

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | FAB visible, bottom sheet fermé |
| Bottom sheet ouvert | 6 actions affichées |
| Mode urgence | FAB transformé icône ⚠️ rouge |
| Tab Profil | FAB caché |
| Mode Ramadan jeûne | Action Repas grisée |

---

## 🧪 Tests prioritaires

- **Présence FAB** : tester sur les 5 tabs (4 visible, 1 caché)
- **Long press** : valider raccourci dernière action
- **Modes contextuels** : Ramadan, urgence active
- **Drag-to-dismiss** : geste fonctionne iOS + Android
- **Accessibilité** : cible tactile ≥48dp, VoiceOver/TalkBack compatible

---

## 📦 DoD dashboard-spécifique

- [ ] FAB testé sur toutes les tabs concernées
- [ ] Long press raccourci dernière action fonctionnel
- [ ] Transformations modes contextuels validées
- [ ] Accessibilité VoiceOver/TalkBack OK
- [ ] iOS + Android testés sur 3 devices chacun

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-3355
- US liées : US-3044, US-3062, US-3078, US-3093, US-3104, US-3109

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
