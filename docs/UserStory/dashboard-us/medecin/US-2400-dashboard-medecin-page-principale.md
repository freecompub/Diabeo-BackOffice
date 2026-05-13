# US-2400 — Dashboard médecin (page principale)

> 📌 **medecin** · Priorité **MVP** · Remplace `US-2094`

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2400` |
| **Type** | Page composite |
| **Priorité** | **MVP** |
| **Story points** | **8** |
| **Persona** | DOCTOR, NURSE (🖥️ Web ≥1024px) |
| **Dépendances** | US-2001 (login), US-2011 (audit), US-2012 (RBAC), US-2018 (fiche patient), US-2401 (card urgences), US-2402 (card RDV), US-2403 (card patients à suivre), US-2404 (KPI cabinet) |
| **Remplace** | US-2094 (Tableau de bord population — à archiver) |

---

## 📋 Contexte produit

Page d'entrée du backoffice pour DOCTOR/NURSE. Compose 4 zones : urgences en cours (priorité absolue), RDV du jour (planning), patients à suivre (suivi proactif), KPI cabinet (vue agrégée). Mise à jour temps réel pour les urgences via WebSocket. Sessions longues en consultation (15-60 min) + checks rapides entre 2 RDV.

Cf prototype interactif « Dashboard médecin » et écran SCR-115.

---

## 🎨 Composition

### Layout grid 2x2 sur écran ≥1280px

```
┌──────────────────┬──────────────────┐
│ Card urgences    │ Card RDV jour    │
│ (US-2401, MVP)   │ (US-2402, MVP)   │
├──────────────────┴──────────────────┤
│ Card patients à suivre              │
│ (US-2403, MVP)                      │
├─────────────────────────────────────┤
│ Section KPI cabinet 14j             │
│ (US-2404, V1)                       │
└─────────────────────────────────────┘
```

### Breakpoints
- ≥1280px : grille 2x2
- 1024-1280px : 1 colonne (urgences en haut)
- <1024px : version compacte (cas mobilité, rare)

### Top header
- Logo, recherche globale Cmd+K, notifications, profil

### Sidebar fixe ~200px
- Tableau de bord (actif), Patients, RDV, Urgences (badge), Messages, Analytics, Administration (RBAC ADMIN)

---

## ✅ Critères d'acceptation

### AC-1 — Composition responsive
```gherkin
Étant donné un médecin sur écran ≥1024px
Quand il ouvre le dashboard
Alors les 4 zones sont affichées en grille adaptée à la largeur
```

### AC-2 — Périmètre patient médecin
```gherkin
Étant donné un médecin avec 50 patients
Quand le dashboard se charge
Alors urgences, RDV et patients filtrés sur son portefeuille (referentId)
```

### AC-3 — Performance cohorte
```gherkin
Étant donné un cabinet de 500 patients
Quand le médecin charge le dashboard
Alors LCP < 2s, toutes les cards rendues en < 3s
```

### AC-4 — Mise à jour temps réel urgence
```gherkin
Étant donné médecin sur le dashboard
Quand une urgence se déclenche dans son portefeuille
Alors la card urgences se met à jour en <10s via WebSocket + animation discrète
```

### AC-5 — Chargement progressif
```gherkin
Étant donné dashboard en cours de chargement
Quand une card n'a pas reçu ses données
Alors skeleton loader, chaque card se révèle indépendamment
```

### AC-6 — RBAC VIEWER
```gherkin
Étant donné utilisateur VIEWER
Quand il charge le dashboard
Alors cards visibles mais actions désactivées (tooltip explicatif)
```

### AC-7 — RBAC NURSE
```gherkin
Étant donné utilisateur NURSE
Quand il charge le dashboard
Alors même contenu que DOCTOR mais sans boutons 'Créer proposition d'ajustement'
```

### AC-8 — Recherche globale Cmd+K
```gherkin
Étant donné médecin sur le dashboard
Quand il tape Cmd+K
Alors la palette de recherche s'ouvre, focus sur l'input
```

---

## 📐 Règles métier spécifiques

- **RM-1** : Cards en cache Redis (TTL : 60s urgences, 300s RDV/patients, 600s KPI)
- **RM-2** : WebSocket pour urgences uniquement, poll 5 min pour les autres
- **RM-3** : Max 5 items par card avec CTA 'Voir tout' qui ouvre la page dédiée
- **RM-4** : Périmètre patient strict : médecin voit ses patients (referentId) ou patients délégués (HealthcareMember)
- **RM-5** : Variantes par contexte : multi-entité (switcher), mode urgence active (bannière), mode dégradé (banner orange)

> Pour les règles transverses (audit, chiffrement, RGPD), cf cadre commun du projet (`docs/security/baseline.md`).

---

## 🔌 API

```
GET /api/dashboard/medecin
  → { urgences, rdv, patientsAtRisk, kpi }

WS /api/dashboard/medecin/stream
  → events : urgency.new, urgency.resolved, rdv.imminent

GET /api/search?q=...&scope=patients,actions,screens
  → résultats catégorisés (Cmd+K)
```

---

## 🚦 États & erreurs

| État | Comportement |
|---|---|
| Default | 4 zones affichées avec data |
| Loading | Skeleton par card (chargement indépendant) |
| Card error | État erreur isolé sur cette card, autres restent OK |
| Empty | Message pédagogique par card |
| Offline | Fallback cache Redis 5 min + bannière |
| Urgence active portefeuille | Card urgences animée (pulse rouge) |
| 401/403 | Redirect login / page 403 |

---

## 🧪 Tests prioritaires

- **Performance** : LCP < 2s, INP < 200ms (Lighthouse CI)
- **WebSocket** : connexion, reconnexion auto, latence < 10s, 50 connexions simultanées
- **RBAC** : tests par rôle (DOCTOR, NURSE, VIEWER, ADMIN)
- **Périmètre patient** : test d'accès hors portefeuille → 403
- **Cache Redis** : hit rate > 80% en production
- **Audit** : AuditLog créé à chaque chargement

> Plan de test détaillé dans `docs/testing/baseline.md`.

---

## 📦 DoD dashboard-spécifique

- [ ] LCP < 2s vérifié (Lighthouse CI)
- [ ] WebSocket testé en charge (50 connexions simultanées)
- [ ] Cache Redis configuré (TTL différenciés)
- [ ] Tous les états gérés (loading, empty, error, offline)
- [ ] Tests RBAC par rôle verts
- [ ] AuditLog vérifié à chaque chargement
- [ ] Variantes contextuelles validées (urgence active, dégradé, multi-cabinet)

> DoD générale dans `docs/dod/baseline.md`.

---

## 🔗 Liens

- Cartographie écran : SCR-115
- Prototype : Dashboard médecin
- US satellites : US-2401, US-2402, US-2403, US-2404
- US remplacée : US-2094

*Cadres communs : `docs/security/baseline.md`, `docs/testing/baseline.md`, `docs/dod/baseline.md`*
