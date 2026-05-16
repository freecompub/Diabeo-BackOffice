# DPIA — US-2108 Relances factures automatiques

> Document Privacy Impact Assessment pour le cron J+7/J+15/J+30 de
> relances factures automatiques (Batch 4 Facturation).
> RGPD Art. 35 + CNIL délibération 2018-326.
> Statut : draft V1 — validation DPO en cours.

---

## 1. Périmètre du traitement

- **Données traitées** :
  - `User.email` (chiffré AES-256-GCM, déchiffré au moment du send Resend).
  - `User.language` (FR/EN/AR — choix template i18n).
  - `Invoice.number` / `totalCents` / `currency` / `issuedAt`.
  - Délai d'échéance calculé (J+7/J+15/J+30).
  - Journal `InvoiceReminder` (status, sentToEnc chiffré, emailMessageId Resend).

- **Personnes concernées** : patients (data subjects) avec facture cabinet
  impayée. Pas les soignants (qui sont sur `sendDoctorEmergencyAlert`
  US-2266 séparé).

- **Finalité** :
  - Recouvrement de créance cabinet médical.
  - Information patient sur dette en cours.

- **Base légale RGPD** :
  - **Art. 6.1.b** : exécution du contrat de soin / facturation cabinet.
  - **Art. 6.1.c** : obligation légale comptable (CGI Art. 242 nonies A —
    conservation factures 10 ans).
  - **Art. 9.2.h** : si l'existence de la facture révèle un suivi médical
    (PHI dérivé) — soins de santé par PS soumis au secret.

- **Pas de PHI direct dans l'email** : aucune mention TIR/glucose/
  pathologie. Anti-PHI strict validé par healthcare-security-auditor
  round 2 INFO-3.

---

## 2. Mesures techniques implémentées

| Mesure | Référence | Statut |
|---|---|---|
| Chiffrement AES-256-GCM `User.email` (déchiffrement just-in-time) | `safeDecryptField` | ✅ |
| Chiffrement AES-256-GCM `InvoiceReminder.sentToEnc` | `encryptField` | ✅ |
| Idempotence absolue `@@unique([invoiceId, step])` | migration + UNIQUE | ✅ |
| Advisory lock global `pg_try_advisory_xact_lock` (anti double-run) | `processOverdueInvoices` H5 | ✅ round 2 |
| Filtre RGPD Art. 17 `patient.deletedAt: null + user.status='active'` | `where` clause | ✅ round 2 H1 |
| Anonymisation `sentToEnc` post-deletion patient | `deletion.service.ts` | ✅ round 2 H6 |
| Sanitize Resend errorMessage (anti PII leak) | `sanitizeResendError` | ✅ round 2 H4 |
| Recheck `status='issued'` pré-persist (TOCTOU paid) | `persistReminder` M3 | ✅ round 2 |
| Pivot `metadata.patientId` audit US-2268 | `persistReminder` | ✅ round 2 H8 |
| Audit `cron.auth.failed` accessDenied US-2265 | `route.ts` | ✅ round 2 H9 |
| Bearer `CRON_SECRET` timing-safe `timingSafeEqual` | `route.ts` | ✅ |
| Env validation `assertRequiredEnv` (ADR #20) | `env.ts SPEC_CRON_SECRET` | ✅ round 2 H10 |
| Headers ANSSI RGS §4.5 (Cache-Control + Referrer + nosniff) | `SECURITY_HEADERS` | ✅ round 2 M9 |
| Parallelism `p-limit(10)` + timeout 50s | `processOverdueInvoices` H3 | ✅ round 2 |
| `orderBy issuedAt asc` (oldest first) | M9 | ✅ round 2 |
| i18n FR/EN/AR (US-2112 cohérence) | `REMINDER_I18N` | ✅ |
| Anti-PHI strict template (aucune donnée santé) | INFO-3 validé HSA | ✅ |
| RGPD Art. 20 export `invoices[].reminders[]` déchiffré | `export.service.ts` | ✅ |
| FK cascade `Invoice → InvoiceReminder` | migration ON DELETE CASCADE | ✅ |

---

## 3. Risques résiduels V1 (décision DPO requise)

### 3.1 HIGH — Resend = transfert hors-UE (Resend Inc. San Francisco, CA)

- **Risque** : `email` patient + numéro facture + montant transitent par
  Resend US. Schrems II / FISA 702 / EO 14086 → transfert non-conforme
  Art. 44+ RGPD sans SCC ou DPF.
- **Mitigation V1** :
  - TLS 1.3 Diabeo → Resend.
  - Resend conserve métadonnées 30j (message-id) sans contenu après
    delivery — à vérifier dans DPA.
- **Plan V1.5** :
  1. Signer DPA + SCC avec Resend Inc.
  2. Lister Resend dans registre sous-traitants Art. 28.
  3. TIA (Transfer Impact Assessment) documenté.
  4. Alternative EU envisageable : Sendgrid EU, Mailgun EU, OVH Emails
     (si DPO refuse Resend).
- **Décision DPO** : valider Resend ou migrer vers fournisseur EU.

### 3.2 MEDIUM — `errorMessage` Resend peut echo l'email patient

- **Risque** : Resend retourne parfois `"Invalid email: john@example.com"`
  → l'email plaintext est echo dans le message d'erreur, persisté en BDD
  `InvoiceReminder.errorMessage` plaintext.
- **Mitigation V1** : `sanitizeResendError` scrub avec :
  1. Replace exact `emailPlain` par `<recipient>`.
  2. Regex generic email-like → `<recipient>` (defense-in-depth).
  3. `.slice(0, 500)` cap longueur.
- **Acceptabilité** : OK V1.

### 3.3 MEDIUM — Délais 7/15/30 hardcodés vs CGI Art. L.441-10

- **Risque** : Loi LME 2008 impose 30 jours de paiement par défaut +
  mentions obligatoires (intérêts retard + indemnité 40€). Les délais
  Diabeo + textes templates ne reflètent pas ces obligations légales
  spécifiques aux créances B2B/B2C cabinet.
- **Mitigation V1** : pilote 1-3 cabinets fermés acceptant cette
  posture provisoire.
- **Plan V1.5** : 
  - Ajouter `Invoice.dueDate` colonne (vs cron calcule J+N depuis
    `issuedAt` qui n'est pas la vraie échéance).
  - Personnaliser FROM/Reply-To par cabinet (LCEN Art. 6).
  - Templates incluant intérêts retard + indemnité forfaitaire 40€.
  - Filtre `paymentMethod = 'cpam_tiers_payant'` exclus (attente CPAM
    pas la faute patient).
- **Décision DPO + Direction Médicale** : valider posture V1 limitée à
  pilote interne.

### 3.4 LOW — Émetteur "Diabeo" générique au lieu du cabinet

- **Risque** : email "Diabeo — Facture en attente" pourrait être
  contesté par le patient (créance émise par cabinet, pas par Diabeo).
- **Mitigation V1** : template mentionne "contactez votre cabinet via
  l'application" → redirection contextuelle.
- **Plan V1.5** : `FROM: Cabinet X <noreply+cabinet-X@diabeo.fr>` +
  Reply-To configurable.

### 3.5 LOW — `emailMessageId` Resend stocké en clair

- **Risque** : Resend message-id est un UUID opaque, ne révèle pas le
  contenu mais permet de re-correlation via Resend dashboard si compte
  Resend Diabeo compromis.
- **Mitigation V1** : message-id utile uniquement debug rebonds via
  Resend dashboard (rare). Acceptable car opaque.
- **Plan V2** : webhook Resend `email.bounced` / `email.delivered` pour
  matérialiser le delivery réel (audit `EMAIL_SUBMITTED` vs
  `EMAIL_DELIVERED`).

---

## 4. Conformité ANSSI / HDS / RGPD

- **RGS §B1** : AES-256-GCM (`User.email`, `sentToEnc`) + HMAC. ✅
- **RGS §3.5** : monitoring auth Bearer + audit `cron.auth.failed` US-2265. ✅
- **RGS §4.5** : headers Cache-Control + Referrer + nosniff. ✅
- **ADR #20** : `CRON_SECRET` early-fail env validation. ✅
- **ADR #18 US-2268** : `metadata.patientId` pivot forensique. ✅
- **HDS Art. L.1111-8** : traçabilité audit transactionnel + cron.run
  metrics. ✅
- **RGPD Art. 6.1.b/c** : base légale documentée (contrat + obligation
  comptable). ✅
- **RGPD Art. 9.2.h** : si PHI dérivé, soins de santé par PS. ✅
- **RGPD Art. 17** : filtre `deletedAt` + anonymisation `sentToEnc`. ✅
- **RGPD Art. 20** : export inclut `reminders[]` déchiffré. ✅
- **RGPD Art. 22** : décision automatisée — pas d'effet juridique direct
  (juste un email rappel). ✅ pas Art. 22 strict.
- **RGPD Art. 35** : DPIA produite (ce document). ✅ (signatures pending).
- **RGPD Art. 44+** : ⚠️ Resend US — voir §3.1.
- **CGI Art. 242 nonies A** : conservation factures + reminders 10 ans
  (cascade ON DELETE jamais déclenchée car `enforce_invoice_immutability`
  trigger block DELETE post-issuance). ✅

---

## 5. Workflow opérationnel

```
1. Cron OVH/Vercel/GH-Action déclenche GET ou POST sur /api/cron/billing/reminders
   à 9h Paris quotidien
2. Middleware bypass JWT pour /api/cron/* + strip x-user-* spoofed headers
3. Route valide Bearer CRON_SECRET (timing-safe) ; 401 si KO + audit
   `cron.auth.failed`
4. Service `processOverdueInvoices` :
   a. Acquiert advisory lock global PG (anti double-run)
   b. Si lock pris par autre run → metrics{skippedConcurrent:true} + return
   c. Pour chaque step (7/15/30) :
      - SELECT invoices status='issued' AND issuedAt<=now-N AND
        reminders.none(step) AND patient.deletedAt=null AND user.status='active'
        ORDER BY issuedAt ASC LIMIT 500
      - Parallel p-limit(10) sendReminderForInvoice :
        * Déchiffre User.email → Resend send → status sent/failed
        * Si pas patient/decrypt fail → status skipped
      - Si timeout 50s atteint → break (idempotence laisse pour run+1)
   d. Audit cron.run metrics (durationMs, sent, failed, skipped, timedOut)
5. Réponse JSON metrics 200
```

---

## 6. Procédures opérationnelles

### 6.1 Configuration cron OVH/Vercel/GitHub Action

```yaml
# .github/workflows/cron-billing-reminders.yml
name: Cron Billing Reminders
on:
  schedule:
    - cron: '0 9 * * *'  # 9h Paris quotidien
jobs:
  reminders:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST https://app.diabeo.fr/api/cron/billing/reminders \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -H "Content-Type: application/json" \
            --max-time 120 \
            --fail
```

### 6.2 Désactivation cron en cas d'incident

```bash
# Vider CRON_SECRET dans secret manager → route 503 silencieux
ovh-secret-manager delete CRON_SECRET --env prod
# Re-déployer Next.js pour propager (assertRequiredEnv crash au boot
# bloque le redémarrage — supprimer CRON_SECRET = blocage prod).
# Préférer : redéployer avec feature flag REMINDERS_ENABLED=false (V1.5).
```

### 6.3 Métriques observability

- Audit log resource=`INVOICE_REMINDER` kind=`cron.run` → metrics par run.
- Alert Grafana / Sentry si :
  - `metrics.failed > 50` sur un run → Resend down ou quota.
  - `metrics.timedOut === true` sur 3 runs consécutifs → cron à
    paralléliser plus / réduire MAX_INVOICES_PER_STEP.
  - `metrics.skippedConcurrent === true` → 2 cron schedulers actifs
    (désactiver le doublon).

---

## 7. Validation

- [ ] Signature DPO sur §3.1 (Resend US transfert hors-UE)
- [ ] DPA + SCC Resend signés + archivés
- [ ] Registre sous-traitants Art. 28 mis à jour
- [ ] Décision Direction Médicale sur §3.3 (délais 7/15/30 V1 acceptable)
- [ ] Cron schedule prod configuré (`0 9 * * *`)
- [ ] CRON_SECRET provisionné secret manager OVH
- [ ] Monitoring Grafana alerts configurées (§6.3)
- [ ] Runbook désactivation §6.2 testé en staging

---

## 8. Signatures

| Rôle | Nom | Date | Signature |
|------|-----|------|-----------|
| DPO  | _________ | _____ | _____ |
| RSSI | _________ | _____ | _____ |
| Direction Médicale | _________ | _____ | _____ |
| CTO | _________ | _____ | _____ |

---

**Références** :
- PR #417 (rounds 1+2 review multi-agents)
- US-2074 (Resend email service)
- US-2102 (Facture PDF + IBAN — facture data source)
- US-2103 (Facturation patient FR — Invoice model)
- US-2107 (Versioning facture immuable — trigger block DELETE)
- US-2268 ADR #18 (audit `metadata.patientId` pivot)
- US-2265 (`accessDenied` audit burst detection)
- US-2112 (i18n FR/EN/AR LocaleSwitcher)
- ADR #20 (early-fail env validation)
- CLAUDE.md (architecture HDS Diabeo)
- RGPD : Art. 6.1.b/c, 9.2.h, 17, 20, 22, 35, 44+
- CNIL : délibération 2018-326 (liste DPIA-required) ; précédent Doctolib 2021 (Resend US-like)
- HDS : Art. L.1111-8 traçabilité
- ANSSI : RGS §B1, §3.5, §4.5
- ADR #20 (CLAUDE.md) : early-fail env validation
- CGI : Art. 242 nonies A (conservation factures), Art. L.441-10 (recouvrement créance B2B)
- LCEN Art. 6 (identification émetteur email commercial)
- LME 2008 (délais paiement 30 jours)
