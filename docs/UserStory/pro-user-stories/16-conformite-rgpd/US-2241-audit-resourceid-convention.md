# US-2241 — Convention `auditLog.resourceId` normalisée

> 📌 **16. Conformité & RGPD** · Priorité **V1** (non bloquant MVP) · Pays **Universel**
>
> 💬 **Origine** : Follow-up review PR #343 (`healthcare-security-auditor` H-A). Convention drift sur le composant `resourceId` empêche les requêtes forensics par patient.

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2241` |
| **Domaine** | 16. Conformité & RGPD |
| **Priorité** | **V1** (technical debt — non bloquant pour MVP, bloquant pour audit HDS prochaine certification) |
| **Pays cible** | Universel |
| **Story points** | **8** (touche ~67 call sites de `auditService.log`) |
| **Statut** | 🆕 À démarrer |
| **Dépendances** | Aucune |
| **Owner** | À assigner |

---

## 📋 Contexte métier

### Pourquoi cette US existe ?

Le service `auditService.query()` (et `getByResource`) attend un `resourceId` plat (ex: `"42"`) pour reconstruire la chronologie des accès à une ressource. Or, le code applicatif utilise des compositions :

```typescript
resourceId: `${patientId}:objectives`
resourceId: `${patientId}:emergency-alert:${alertId}`
resourceId: `${patientId}:emergency-alert:${alertId}:action`
```

Conséquences :
1. **getByResource("PATIENT", patientId)** ne retrouve que les events où `resourceId === "{patientId}"`. Tous les events composites sont **invisibles** dans la timeline forensics du patient.
2. CNIL / ANS demandent en audit *« qui a accédé aux données du patient X »* — actuellement on ne peut pas y répondre par une requête simple.
3. Le tri par patient nécessite un `LIKE '${patientId}:%' OR resourceId = '${patientId}'` — coûteux à grande échelle.

### Décision proposée

Normaliser sur :
- `resource: AuditResource` enum élargi (`PATIENT`, `EMERGENCY_ALERT`, `EMERGENCY_ALERT_ACTION`, `OBJECTIVE`, `ALERT_THRESHOLD`, etc.)
- `resourceId: string` plat = ID natif de la ressource (alertId, objectiveId, etc.)
- `metadata.patientId: number` quand pertinent

Permet :
- `getByResource("PATIENT", "42")` → tous les events PATIENT du patient 42
- `getByPatient("42")` → tous les events liés (PATIENT + EMERGENCY_ALERT + ... avec metadata.patientId === 42) via une nouvelle helper.

### Valeur produit

- **HDS / ANS** : reconstitution forensics par patient en O(log n).
- **CNIL Art. 32** : preuve formelle de la traçabilité.
- **Equipe sécurité** : grep audit log devient praticable.

---

## ✅ Critères d'acceptation

### AC-1 — Enum AuditResource étendu

```gherkin
Étant donné le type AuditResource actuel
Quand on l'élargit avec EMERGENCY_ALERT, EMERGENCY_ALERT_ACTION,
                       ALERT_THRESHOLD_CONFIG, KETONE_THRESHOLD,
                       HYPO_TREATMENT_PROTOCOL, OBJECTIVE,
                       PREGNANCY_MODE
Alors TypeScript compile + tests existants verts
```

### AC-2 — Migration des call sites

```gherkin
Étant donné les ~67 appels à auditService.log
Quand on remplace les resourceIds composites par {resource: <enum>, resourceId: <id>, metadata.patientId: <patientId>}
Alors aucun audit log existant n'est cassé (resourceId reste string libre)
Et les nouveaux logs respectent la convention
Et un test integration vérifie le pattern sur les routes Mirror MVP
```

### AC-3 — Helper `getByPatient`

```gherkin
Étant donné un patientId X
Quand on appelle auditService.getByPatient(X)
Alors on récupère tous les AuditLog où resource = PATIENT && resourceId = X
                              OR metadata->>'patientId' = X (JSONB lookup)
Et le résultat est trié par createdAt DESC, paginé
```

### AC-4 — Index PostgreSQL sur metadata.patientId

```gherkin
Étant donné les requêtes par patient sont fréquentes
Quand on crée un index GIN partiel sur (metadata->'patientId') WHERE metadata ? 'patientId'
Alors les recherches getByPatient sont sub-100ms à 10M de logs
```

### AC-5 — Backfill des anciens logs (best-effort)

```gherkin
Étant donné les logs existants utilisent l'ancien format composite
Quand un script de backfill idempotent tourne
Alors les resourceIds matchant la regex `^(\d+):(.+)$` sont éclatés
     resource: "PATIENT" / metadata.subResource = "{captured}"
     resourceId reste l'ancien format pour rétrocompat
Et le backfill peut être rejoué sans effet
```

### AC-6 — Documentation mise à jour

```gherkin
Étant donné la nouvelle convention
Quand on consulte CLAUDE.md section "Audit & Traçabilité HDS"
Alors le pattern est documenté avec exemples avant/après
Et un linter custom (ou commentaire JSDoc) avertit en code review si le pattern composite réapparaît
```

---

## 📐 Règles métier

- **RM-1** : `resource` est un enum strict (TypeScript + DB constraint).
- **RM-2** : `resourceId` est plat — l'identifiant primaire de la ressource, jamais composite.
- **RM-3** : `metadata.patientId` est le pivot pour les ressources « rattachées à un patient » (alertes, objectifs, etc.).
- **RM-4** : pas de PHI dans les nouvelles ressources. Les ressources héritent du chiffrement déjà en place.
- **RM-5** : le backfill est best-effort — les logs antérieurs au refacto peuvent rester en composite (compat).

---

## 🔌 Impact technique

### Périmètre

Recherche grep `:emergency-alert\|:objectives\|:hypo-treatment\|:ketone-thresholds\|:alert-thresholds\|:pregnancy-mode` → ~30 occurrences à refactorer.

### Étapes proposées

1. **Élargir `AuditResource` enum** dans `audit.service.ts`.
2. **Refactorer les call sites Mirror MVP** (les plus récents d'abord, c'est moins risqué).
3. **Refactorer les call sites historiques** par batches de 5-10 par PR.
4. **Ajouter helper** `auditService.getByPatient(patientId, opts)` avec query optimisée.
5. **Migration SQL** : index GIN partiel.
6. **Script backfill** dans `scripts/backfill-audit-resourceid.ts`.
7. **Update CLAUDE.md** avec la nouvelle convention + exemple.

### Risques

- 🔴 **Breaking change** sur `auditService.query` si typage trop strict — mitigation : accepter `string` au lieu de `AuditResource` pendant une fenêtre de migration.
- 🟠 Volume de touches dans la diff (~50+ fichiers) — mitigation : PR séparée par domaine (urgences / objectifs / patient / etc.).

---

## 🧪 Plan de test

- Unit `audit.service.test.ts` : nouveau helper `getByPatient`.
- Integration : refacto Mirror MVP, vérifier que les anciens tests passent + nouveau pattern fonctionne.
- Performance : benchmark `getByPatient` sur 10M logs (test E2E recette).
- Backfill : script testé sur dump anonymisé recette, idempotence vérifiée.

---

## 📦 Définition de Done

- [ ] Code review approuvée + healthcare-security-auditor
- [ ] Tests verts (unit + integration + E2E)
- [ ] Migration SQL appliquée + index GIN
- [ ] Backfill testé (idempotent)
- [ ] CLAUDE.md mis à jour
- [ ] Validation `architect-reviewer` (cross-cutting impact)

---

## 🔗 US liées

- US-2011 (audit log immuable) — base
- US-2238 (ACCESS_DENIED forensic) — bénéficie de la convention
- US-2238–2240 — toutes les follow-ups Mirror MVP
