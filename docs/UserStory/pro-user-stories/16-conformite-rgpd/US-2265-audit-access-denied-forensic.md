# US-2265 — Événements `ACCESS_DENIED` dans l'audit log

> 📌 **16. Conformité & RGPD** · Priorité **MVP** · Pays **Universel**
>
> 💬 **Origine** : Follow-up review multi-agents PR #343 (Mirror MVP) — finding healthcare-security-auditor L-A.

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2265` |
| **Domaine** | 16. Conformité & RGPD |
| **Priorité** | **MVP** |
| **Pays cible** | Universel |
| **Story points** | **2** |
| **Statut** | 🆕 À démarrer |
| **Dépendances** | US-2011 (audit log immuable), US-2012 (RBAC) |
| **PR origine** | #343 (Mirror MVP — `loadForAccessCheck`) |
| **Owner** | À assigner |

---

## 📋 Contexte métier

### Pourquoi cette US existe ?

Lors du review du Mirror MVP, l'auditeur sécurité (`healthcare-security-auditor`) a noté que `loadForAccessCheck` (utilisé pour vérifier les droits avant d'auditer une lecture sensible) ne produit **aucun événement** quand un utilisateur authentifié tente d'accéder à une ressource hors-périmètre. C'est intentionnel pour éviter l'oracle d'existence — mais cela prive aussi le SOC de signaux RBAC-breach.

Aujourd'hui, un NURSE qui sonde des ID d'`emergency-alerts` hors de son service obtient un `403` muet : aucun audit trail, aucun signal sécurité. À l'échelle, c'est une fenêtre aveugle pour la détection de comportements anormaux (énumération, escalade tentée).

### Valeur produit

- **Pour le DPO / SOC** : visibilité sur les tentatives d'accès non autorisées (RBAC-breach attempt).
- **HDS / ANS** : traçabilité conforme §IV.3 sur les accès *refusés* aux données de santé, pas seulement les accès accordés.
- **CNIL** : matérialise les contrôles d'accès (RGPD Art. 32) en cas d'audit.

---

## ✅ Critères d'acceptation

### AC-1 — Tentative bloquée enregistrée

```gherkin
Étant donné un utilisateur authentifié sans droit d'accès à un patient X
Quand il appelle GET/PATCH /api/emergency-alerts/{id} (alerte du patient X)
Alors la requête est rejetée 403
Et un AuditLog est créé avec action="UNAUTHORIZED", resource="EMERGENCY_ALERT",
    resourceId={alertId}, metadata={ patientId, requestedAction }
```

### AC-2 — Probing d'IDs inexistants reste silencieux

```gherkin
Étant donné un utilisateur authentifié
Quand il sonde un ID d'alerte qui n'existe pas
Alors la requête est rejetée 404 (sans audit, pour ne pas créer un oracle d'énumération)
```

### AC-3 — Anti-spam du SOC

```gherkin
Étant donné le même utilisateur enchaîne 50 tentatives 403 en moins de 60s
Quand le 51ᵉ événement est émis
Alors un événement supplémentaire `RBAC_BREACH_BURST` est émis (rate-limit 1/min/userId)
Et une alerte SOC peut être configurée sur ce code
```

### AC-4 — Pas de PHI dans le log

```gherkin
Étant donné un événement ACCESS_DENIED est émis
Quand on inspecte la ligne d'audit
Alors aucune donnée santé en clair n'y figure (ni glucose, ni notes, ni nom)
Et seuls userId, action, resource, resourceId, IP, UA sont présents
```

---

## 📐 Règles métier

- **RM-1** : seul un *utilisateur authentifié* qui dépasse RBAC produit `ACCESS_DENIED`. Un anonyme produit déjà `UNAUTHORIZED` (existant).
- **RM-2** : le couple `{action: "UNAUTHORIZED", resource, resourceId}` est suffisant. Pas de description libre.
- **RM-3** : si la ressource n'existe pas, **rester silencieux** (pas d'audit) pour ne pas créer un oracle.
- **RM-4** : burst-detection 50/min/userId déclenche `RBAC_BREACH_BURST` (1 par fenêtre, in-memory ou Redis).

---

## 🔌 Impact technique

Modifications à apporter (≤ 1 jour de travail) :

1. **`auditService` — ajouter** `AuditAction = "UNAUTHORIZED"` (déjà partiellement présent — uniformiser).
2. **Helper** `auditAccessDenied(userId, resource, resourceId, ctx)` à exposer.
3. **Routes Mirror MVP** :
   - `src/app/api/emergency-alerts/[id]/route.ts` (GET/PATCH)
   - `src/app/api/emergency-alerts/[id]/actions/route.ts` (POST)
   - `src/app/api/patient/{alert-thresholds,ketone-thresholds,hypo-treatment,pregnancy-mode}/route.ts`
4. **Burst rate-limit** : Redis bucket `rbac-breach:{userId}` window 60s (cohérent avec `rate-limit.ts`).

---

## 🧪 Tests

- Unit : helper `auditAccessDenied` produit la bonne shape.
- Integration : tentative cross-tenant produit un audit log avec `action: "UNAUTHORIZED"`.
- Integration : tentative sur ID inexistant ne produit *aucun* audit log.
- Integration : 50 tentatives consécutives produisent au plus 1 événement `RBAC_BREACH_BURST`.

---

## 📦 Définition de Done

- [ ] Code review approuvée
- [ ] Tests unitaires + integration verts
- [ ] Audit log immuable inchangé (existing trigger couvre)
- [ ] AuditAction enum mis à jour côté TypeScript
- [ ] Documentation `audit.service.ts` mise à jour
- [ ] Validation `healthcare-security-auditor`

---

## 🔗 US liées

- US-2011 (audit log immuable)
- US-2265 ↔ PR #343 (Mirror MVP — origine du finding)
- US-2153 (logs applicatifs centralisés — destination des burst events)
