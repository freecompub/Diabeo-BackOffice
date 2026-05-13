# US-3360 — Widget Lock Screen / Home Screen — Glycémie

> 📌 **patient-mobile** · Priorité **V1** · Satellite de `US-3355`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-3360` |
| **Type** | Composant satellite |
| **Priorité** | **V1** |
| **Story points** | **8** |
| **Persona** | Patient (📱 iOS + Android) |
| **Dépendances** | US-3047 (dashboard glycémie temps réel), US-3357 (card glycémie live) |
| **US parente** | `US-3355` |

---

## 📋 Contexte produit

Widget OS-natif affichant la glycémie en temps réel sur l'écran d'accueil (iOS Home Screen + Lock Screen, Android Glance widget). Cible UX : voir sa glycémie en <1s sans déverrouiller le téléphone. Implémentations OS-spécifiques fondamentalement différentes (WidgetKit iOS / Glance Android).

---

## 🎨 Composition

### iOS — Widgets (WidgetKit, iOS 16+)
- **Small (2×2)** : grand chiffre + tendance + heure dernière sync
- **Medium (4×2)** : chiffre + tendance + mini-courbe 3h
- **Lock Screen rectangular** (iOS 16+) : version ultra-compacte texte
- **Lock Screen circular** (iOS 16+) : juste le chiffre central

### Android — Glance (Compose Glance, Android 12+)
- **Small** : équivalent iOS small
- **Medium** : équivalent iOS medium
- **Quick Settings tile** (optionnel) : tile dans panneau notifs

### Mise à jour
- iOS : TimelineProvider, timeline réactualisée toutes les 5 min (limite OS)
- Android : GlanceAppWidget + WorkManager toutes les 5-15 min

### Cible UX
- Lecture en <1s sans déverrouiller
- Couleur informative (vert in-range, ambre élevé, rouge hypo)
- Police claire et lisible à distance

---

## ✅ Critères d'acceptation

### AC-1 — Widget Small iOS
```gherkin
Étant donné patient installe widget Small sur Home Screen
Quand consulte l'écran
Alors glycémie + tendance + heure sync visibles en <1s
```

### AC-2 — Widget Medium iOS
```gherkin
Étant donné patient installe widget Medium
Quand consulte
Alors glycémie + tendance + mini-courbe 3h
```

### AC-3 — Widget Lock Screen iOS
```gherkin
Étant donné patient ajoute widget Lock Screen circular
Quand regarde écran verrouillé
Alors le chiffre est visible sans déverrouiller
```

### AC-4 — Widget Android Glance
```gherkin
Étant donné patient ajoute widget Android 12+
Quand consulte Home Screen
Alors équivalent visuel iOS adapté Material Design
```

### AC-5 — Mise à jour 5 min
```gherkin
Étant donné 5 min depuis dernière sync
Quand iOS rafraîchit timeline
Alors nouvelle valeur affichée (si évolution)
```

### AC-6 — Couleur informative
```gherkin
Étant donné glycémie en hypo (<70)
Quand widget se rend
Alors couleur rouge + icône warning
```

### AC-7 — Tap widget = ouverture app
```gherkin
Étant donné patient tape sur widget
Quand il valide
Alors app s'ouvre sur dashboard glycémie
```

### AC-8 — Donnée stale >30min
```gherkin
Étant donné aucune sync depuis 30 min
Quand widget se rafraîchit
Alors indicateur 'stale' visible (icône grise)
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Pas de PHI sensibles dans widget (juste glycémie + tendance, pas de nom)
- **RM-2** : Mise à jour selon contraintes OS : iOS 5 min minimum, Android 15 min recommandé (battery)
- **RM-3** : Tap widget = ouverture deeplink diabeo://patient/glucose (avec auth si demandée)
- **RM-4** : Conformité Apple guidelines : pas de PHI Lock Screen sans auth (consentement explicite)
- **RM-5** : Couleur cohérente avec design system Sérénité Active

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
iOS — WidgetKit TimelineProvider
fetch via shared App Group container → cache local

Android — Glance + WorkManager
fetch via SharedPreferences ou DataStore → cache local
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | Glycémie + tendance + heure sync |
| Donnée stale (>30min) | Icône grise + 'sync attendu' |
| Pas de données | Empty state 'Connectez votre capteur' |
| Hypo en cours | Couleur rouge + icône warning |
| Mode urgence active | Indicateur procédure en cours |

---

## 🧪 Tests prioritaires

- **iOS** : widget Small/Medium/Lock Screen rectangular/circular sur iPhone et iPad
- **Android** : widget Small/Medium sur 3 devices différents
- **Mise à jour** : valider rafraîchissement périodique
- **Tap widget** : valider deeplink ouverture app
- **Données stale** : tester >30 min sans sync
- **Hypo/hyper** : couleurs correctes
- **Consommation batterie** : <1% par jour

---

## 📦 DoD dashboard-spécifique

- [ ] iOS : Small + Medium + Lock Screen rectangular + circular testés
- [ ] Android : Small + Medium testés sur 3 devices
- [ ] Mise à jour périodique fonctionnelle
- [ ] Tap → deeplink correct
- [ ] Consommation batterie validée (<1% par jour)
- [ ] Conformité guidelines OS (PHI on Lock Screen)

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-3355
- US liée : US-3357 (card glycémie live)

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
