# US-3356 — Dashboard patient — web (page principale)

> 📌 **patient-web** · Priorité **V1**

> ⏸️ **PAUSED** (Q10 session Samir 2026-05-13) — Bloqué par absence dauth patient web. US-2025 (mobile invite) = JWT 15min mono-usage, pas de session web long-vie. Cadrage différé.

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-3356` |
| **Type** | Page composite |
| **Priorité** | **V1** |
| **Story points** | **13** |
| **Persona** | Patient (🌐 Web ≥1024px) |
| **Dépendances** | US-3001 (login), US-3361 (section glycémie 24h), US-3362 (section AGP 7j), US-3363 (panel actions rapides) |

---

## 📋 Contexte produit

Version web de l'app patient pour **consultation à froid** : analyse de tendances, préparation de consultation, export de rapport, partage avec proche. N'est PAS une copie miroir du mobile — densité d'info plus élevée, courbe 24h détaillée avec annotations, AGP 7j en mini-rapport, métriques étendues. Posture assise, écran ≥1024px, sessions longues (10-30 min, quelques fois/semaine).

Cf prototype interactif « Dashboard patient (web) » et écran SCR-P-221.

---

## 🎨 Composition

### Layout 2 zones (5/3 split)

**Zone gauche (5/8) — Analyse glycémique**
- Courbe 24h avec annotations événements (US-3361)
- Sélecteur période 24h/7j/14j/30j
- 4 métriques : TIR, moyenne, CV, HbA1c estimée

**Zone droite (3/8) — Actions & contexte**
- Card proposition médecin (3 boutons accepter/refuser/préciser)
- Prochains événements (bolus prévu, RDV)

### Zone basse (3 colonnes)
- AGP 7 derniers jours résumé (US-3362)
- Stats du jour (5 lignes)
- Panel actions rapides (US-3363)

### Sidebar fixe ~200px
- Accueil, Glycémie, Journal, Communication, Profil, Dispositifs, Préférences, Urgence, Aide

### Top header
- Logo, recherche globale Cmd+K, notifications, avatar

---

## ✅ Critères d'acceptation

### AC-1 — Layout responsive ≥1024px
```gherkin
Étant donné un patient sur écran ≥1024px
Quand il ouvre le dashboard web
Alors le layout 2 zones + 3 colonnes basses s'affiche, sidebar fixe à gauche
```

### AC-2 — Densité d'info adaptée
```gherkin
Étant donné un patient consulte le dashboard web
Quand la page se charge
Alors courbe 24h, AGP 7j, 4 métriques (vs 2 mobile), proposition avec 3 boutons directs
```

### AC-3 — Annotations sur courbe
```gherkin
Étant donné la courbe 24h est affichée
Quand elle se charge
Alors événements (repas, bolus, activités) annotés sur la courbe avec labels
```

### AC-4 — Proposition actionnable direct
```gherkin
Étant donné une proposition est en attente
Quand le patient consulte le dashboard
Alors il peut accepter/refuser/préciser directement depuis le dashboard (3 boutons)
```

### AC-5 — Redirection mobile <768px
```gherkin
Étant donné ouvert sur mobile <768px
Quand la page se charge
Alors bannière 'Pour une meilleure expérience, utilisez l'app mobile' + deeplink store
```

### AC-6 — Export rapport perso
```gherkin
Étant donné clic sur 'Exporter un rapport'
Quand il configure la période
Alors PDF généré avec courbes, métriques, événements
```

### AC-7 — WebAuthn actions sensibles
```gherkin
Étant donné tente d'accepter une proposition
Quand il valide
Alors WebAuthn (Touch ID Mac / Windows Hello / passkey) demandé avant validation finale
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Sidebar fixe ≥1024px, redirection mobile <768px
- **RM-2** : Pas de Web Push critique pour urgences (délégation au mobile), juste informatif
- **RM-3** : Cache navigateur via Service Worker pour mode dégradé hors-ligne
- **RM-4** : WebAuthn pour actions sensibles (acceptation proposition, modification protocole)
- **RM-5** : Conformité RGAA 4.1 obligatoire (services santé France)
- **RM-6** : Pas de Bluetooth (Web Bluetooth API limitée) — affichage read-only des données mobile

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/patient/me/dashboard?range=24h
  → { glucose: { points, annotations, agp7d }, proposals, events, dailyStats }

GET /api/patient/me/agp?period=7d
  → { percentiles: { p5, p25, median, p75, p95 } }

POST /api/patient/me/export-report
  → { reportId, downloadUrl }
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | 2 zones + 3 colonnes affichées |
| Loading | Skeleton par section, chargement indépendant |
| Mobile <768px | Bannière redirection app |
| Offline | Cache Service Worker + bannière |
| WebAuthn requis | Modal native navigateur pour validation biométrique |
| Mode contextuel actif | Header adapté (grossesse, pédiatrique) |

---

## 🧪 Tests prioritaires

- **Performance Lighthouse** : LCP < 2.5s, INP < 200ms
- **Accessibility axe-core** : 0 violation critique, conformité RGAA 4.1
- **Cross-browser Playwright** : Chromium, Firefox, WebKit
- **Responsive** : tester 1024px, 1280px, 1440px, 1920px
- **WebAuthn** : tester Touch ID Mac, Windows Hello, passkey
- **Export PDF** : génération + contenu cohérent

> Plan de test détaillé dans `docs/testing/baseline.md`.

---

## 📦 DoD dashboard-spécifique

- [ ] Lighthouse Performance ≥ 90, Accessibility ≥ 95
- [ ] axe-core 0 violation critique
- [ ] Cross-browser validé
- [ ] Layout testé 1024-1920px
- [ ] WebAuthn fonctionnel
- [ ] Export PDF généré et vérifié
- [ ] Conformité RGAA 4.1 auditée

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- Cartographie écran : SCR-P-221
- Prototype : Dashboard patient web
- US satellites : US-3361, US-3362, US-3363

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
