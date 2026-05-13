# US-2401 — Card urgences en cours (médecin)

> 📌 **medecin** · Priorité **MVP** · Satellite de `US-2400`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2401` |
| **Type** | Composant satellite |
| **Priorité** | **MVP** |
| **Story points** | **8** |
| **Persona** | DOCTOR, NURSE |
| **Dépendances** | US-2224 (inbox urgences), US-2225 (détail timeline), US-2230 (notif temps réel), US-2400 |
| **US parente** | `US-2400` |

---

## 📋 Contexte produit

Card prioritaire du dashboard médecin. Affiche les urgences actives dans le portefeuille avec mise à jour temps réel via **polling 30s** (Q9 session Samir 2026-05-13 — WebSocket reporté V2/V3, push FCM mobile via US-2230 reste le canal d'alerte primaire). Bordure gauche rouge pour signaler la criticité. Actions directes 'Réagir' depuis la card pour gain de temps en consultation.

---

## 🎨 Composition

### Layout
- Header : icône warning + 'Urgences en cours · N'
- Bordure gauche rouge 3px
- CTA 'Voir toutes' en haut à droite
- Max 3-5 urgences affichées
- Chaque urgence :
  - Badge type (DKA, Hypo sévère, Hyper, etc.)
  - Nom patient + âge + pathologie
  - Détail urgence en 1 ligne (glycémie + cétones, durée)
  - Bouton 'Réagir' (ouvre workflow)

### Mise à jour temps réel
- Polling 30s (Q9 — WebSocket V2/V3)
- Nouvelle urgence : apparition slide-down + pulse rouge
- Urgence résolue : fade-out

---

## ✅ Critères d'acceptation

### AC-1 — Liste urgences portefeuille
```gherkin
Étant donné médecin a 2 urgences actives
Quand il consulte le dashboard
Alors les 2 urgences affichées avec criticité visuelle
```

### AC-2 — MAJ via polling 30s
```gherkin
Étant donné nouvelle urgence se déclenche
Quand le polling 30s récupère un nouvel event
Alors card mise à jour en <10s avec slide-down
```

### AC-3 — Urgence résolue
```gherkin
Étant donné urgence marquée résolue
Quand le polling 30s récupère un nouvel event
Alors card disparaît avec fade-out
```

### AC-4 — Tap 'Réagir' ouvre workflow
```gherkin
Étant donné urgence affichée
Quand médecin clique 'Réagir'
Alors workflow réaction post-urgence s'ouvre (US-2226)
```

### AC-5 — Tri criticité puis fraîcheur
```gherkin
Étant donné 3 urgences avec criticités différentes
Quand elles se rendent
Alors DKA en haut, puis hypo sévère, puis hyper
```

### AC-6 — Empty state rassurant
```gherkin
Étant donné aucune urgence en cours
Quand médecin consulte la card
Alors 'Aucune urgence en cours. Vos patients sont stables.' (vert)
```

### AC-7 — Reprise polling après perte réseau
```gherkin
Étant donné le navigateur se reconnecte après perte réseau
Quand frontend détecte
Alors reconnexion auto avec backoff exponentiel
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Tri urgences : DKA → hypo sévère niveau 2 (<54) → hypo niveau 1 → hyper → autres
- **RM-2** : Max 5 urgences visibles, CTA 'Voir toutes' → page Inbox
- **RM-3** : polling 30s auth via cookie httpOnly (idem auth REST), pas de gestion reconnexion (chaque poll est indépendant)
- **RM-4** : Aucune donnée patient sensible hors nom/âge/pathologie + détail urgence
- **RM-5** : Périmètre patients du médecin strict (referentId ou délégation)

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/medecin/urgencies
  → liste urgences actives portefeuille

WS /api/dashboard/medecin/urgencies/stream
  → events : urgency.new, urgency.updated, urgency.resolved
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default (1+ urgences) | Liste avec criticité, bordure rouge, animations |
| Empty (0 urgence) | Message rassurant vert |
| Loading | Skeleton de 2-3 lignes |
| WS déconnecté | Indicateur 'reconnexion en cours' + poll fallback 30s |
| Erreur | Message erreur + retry |

---

## 🧪 Tests prioritaires

- **Polling 30s** : latence affichage <30s, push FCM US-2230 = canal alerte instantané
- **Charge** : 50 médecins connectés = 1.6 req/s (50/30) — non-bloquant
- **Tri criticité** : valider ordre avec différentes urgences mélangées
- **Empty state** : valider message rassurant
- **Périmètre** : test patient hors portefeuille → exclu

> Plan de test détaillé dans `docs/testing/baseline.md`.

---

## 📦 DoD dashboard-spécifique

- [ ] Polling 30s testé (intervalle stable, pas de fuite de timers au unmount)
- [ ] Latence MAJ < 10s validée
- [ ] Tri criticité fonctionnel
- [ ] Empty state vu et validé par PO
- [ ] Périmètre patient strict appliqué
- [ ] AuditLog action visualisation urgence

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- US parente : US-2400
- US liées : US-2224, US-2225, US-2226, US-2230

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
