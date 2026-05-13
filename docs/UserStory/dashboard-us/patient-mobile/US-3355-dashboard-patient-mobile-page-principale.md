# US-3355 — Dashboard patient — mobile (page principale)

> 📌 **patient-mobile** · Priorité **MVP** · Remplace `FNP-178`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-3355` |
| **Type** | Page composite |
| **Priorité** | **MVP** |
| **Story points** | **13** |
| **Persona** | Patient (📱 iOS + Android) |
| **Dépendances** | US-3001 (login), US-3002 (consentement HDS), US-3357 (card glycémie live), US-3358 (card propositions), US-3359 (FAB quick actions), US-3001 à US-3014 (onboarding terminé) |
| **Remplace** | FNP-178 (Tableau de bord journalier) |

---

## 📋 Contexte produit

Page d'entrée de l'app patient après login, sur les 2 plateformes mobile (iOS + Android). Centrée sur le **moment présent** : glycémie live grand chiffre, courbe 6h, tendance, propositions médecin urgentes, contexte du jour. Pensée pour des sessions courtes (30s à 2min) multiples par jour (5-20×/jour). Cible UX : zéro friction pour les 3 actions les plus fréquentes (saisie glycémie, repas, bolus) accessibles depuis le FAB central.

Cf prototype interactif « Dashboard patient (mobile) » et écran SCR-P-220 dans la cartographie.

---

## 🎨 Composition

### Bloc principal : Glycémie live (~40% écran)
- Grand chiffre (44pt) + unité + flèche tendance
- Mini-courbe 6h avec zones cibles colorées
- Source : US-3357

### Bloc proposition médecin (si présente)
- Card jaune-ambre avec icône, libellé, CTA
- Source : US-3358

### Prochain événement prévu
- Bolus / insuline lente / RDV imminent — compact, 1 ligne

### Stats du jour (grille 4 colonnes)
- Repas saisis · Activité · Hypos · État capteur
- Tap = bascule vers tab journal filtré

### Notif RDV à venir (si dans les 7j)
- Card compact en bas, tap = détail RDV

### FAB central (toujours visible)
- Source : US-3359
- Tap = bottom sheet avec 6 actions rapides

### Bottom nav 5 tabs
- Accueil (actif) · Glycémie · FAB · Communication · Profil

---

## ✅ Critères d'acceptation

### AC-1 — Composition mobile-first
```gherkin
Étant donné un patient connecté sur iOS ou Android
Quand il ouvre l'app
Alors le dashboard s'affiche avec glycémie live en bloc principal, FAB central, bottom nav 5 tabs
```

### AC-2 — Glycémie live <1s
```gherkin
Étant donné le patient ouvre l'app
Quand elle se lance (cold start)
Alors la dernière glycémie connue (cache local) est affichée en <1s, puis sync en arrière-plan met à jour
```

### AC-3 — Pull-to-refresh
```gherkin
Étant donné le patient est sur le dashboard
Quand il fait un geste pull-to-refresh
Alors toutes les cards sont rafraîchies, indicateur visuel pendant le sync
```

### AC-4 — Proposition médecin en avant
```gherkin
Étant donné une proposition est en attente
Quand le dashboard se charge
Alors la card proposition apparaît en position 2 (juste sous la glycémie), couleur ambre
```

### AC-5 — État offline
```gherkin
Étant donné le patient est offline
Quand il ouvre le dashboard
Alors données en cache affichées, bannière jaune 'Hors ligne', le FAB reste actif
```

### AC-6 — Variante mode grossesse
```gherkin
Étant donné le patient est en mode grossesse activé
Quand il ouvre le dashboard
Alors header dédié avec SA, terme prévu, cibles strictes obstétriques
```

### AC-7 — Variante mode pédiatrique
```gherkin
Étant donné compte enfant administré
Quand le parent ouvre le dashboard
Alors switcher de profil enfant visible dans le header
```

### AC-8 — Mode urgence active
```gherkin
Étant donné une urgence hypo est en cours
Quand le patient ouvre le dashboard
Alors bannière rouge persistante en haut, FAB devient bouton 'Voir procédure'
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Données patient chiffrées localement (encrypted CoreData iOS / Room+SQLCipher Android)
- **RM-2** : Cache local 30 jours minimum, accessible offline
- **RM-3** : Sync background via BGTaskScheduler (iOS) / WorkManager (Android) toutes les 15 min
- **RM-4** : Bottom nav et FAB persistants sauf en mode urgence active (FAB transformé)
- **RM-5** : Notifications push reçues en background mettent à jour le cache à l'ouverture
- **RM-6** : Vibration haptique légère sur mise à jour glycémie (préférences utilisateur)

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/patient/me/dashboard
  → { glucose, proposals, events, dailyStats }

WS /api/patient/me/glucose/stream (foreground only)
  → events : glucose.new, alert.triggered

iOS — BGTaskScheduler.identifier = "fr.diabeo.sync"
Android — WorkManager periodic 15min
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default (online + data) | Toutes cards affichées normalement |
| Loading (cold start) | Cache local affiché en <1s, sync en arrière-plan |
| Offline | Cache + bannière jaune persistante |
| Sync en cours | Petit indicateur dans le header |
| Urgence active | Bannière rouge + FAB transformé |
| Mode contextuel | Header et cibles adaptés (grossesse/pédiatrie/Ramadan/voyage) |
| Erreur sync | Toast non bloquant, cache reste utilisable |

---

## 🧪 Tests prioritaires

- **Performance** : ouverture <1s avec cache local, TTI < 2s online
- **Offline** : tester déconnexion réseau pendant utilisation
- **Multi-plateforme** : XCUITest iOS + Espresso Android sur le scénario nominal
- **Modes contextuels** : tester chaque variante (grossesse, pédiatrie, Ramadan, urgence)
- **Sync background** : valider BGTaskScheduler/WorkManager déclenchent
- **Pull-to-refresh** : valide rafraîchissement de toutes les cards

> Plan de test détaillé dans `docs/testing/baseline.md`.

---

## 📦 DoD dashboard-spécifique

- [ ] Performance : ouverture <1s avec cache, TTI <2s online (Lighthouse mobile + Xcode Instruments)
- [ ] iOS + Android testés sur 3 devices chacun
- [ ] Tous les états gérés (online, offline, sync, urgence, modes contextuels)
- [ ] Pull-to-refresh fonctionne et anime
- [ ] AuditLog créé à chaque ouverture
- [ ] Variations modes contextuels validées avec PO
- [ ] Validation healthcare-security-auditor

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- Cartographie écran : SCR-P-220
- Prototype : Dashboard patient mobile
- US satellites : US-3357, US-3358, US-3359, US-3360
- US remplacée : FNP-178

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
