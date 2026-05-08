# US-2239 — Email médecin sur alerte critique (notifyDoctorEmail)

> 📌 **8. Messagerie & notifications** · Priorité **MVP** · Pays **Universel**
>
> 💬 **Origine** : Follow-up review PR #343. `AlertThresholdConfig.notifyDoctorEmail` est défini, exposé en API, mais jamais consommé — soit on câble, soit on drop. Choix : câbler.

---

## 📊 Métadonnées

| Champ | Valeur |
|---|---|
| **ID** | `US-2239` |
| **Domaine** | 8. Messagerie & notifications |
| **Priorité** | **MVP** |
| **Pays cible** | Universel |
| **Story points** | **3** |
| **Statut** | 🆕 À démarrer |
| **Dépendances** | US-2074 (email transactionnel Resend) ✅, US-2224 (inbox urgences) ✅, PR #343 |
| **Owner** | À assigner |

---

## 📋 Contexte métier

### Pourquoi cette US existe ?

Lors du build du Mirror MVP (PR #343), `AlertThresholdConfig.notifyDoctorEmail` a été ajouté au schéma + UI + API mais le service `emergency.service.ts` ne consomme que `notifyDoctorPush`. Conséquence : le médecin référent peut activer "email sur alerte critique" — sans aucun email envoyé.

Trois agents reviewers (`code-reviewer`, `prisma-specialist`, `healthcare-security-auditor`) ont flaggé cette divergence comme dette technique. La décision produit : **câbler l'envoi email** plutôt que retirer le champ, car les médecins de terrain demandent souvent un canal email parallèle au push (terminal verrouillé, smartphone éteint la nuit).

### Valeur produit

- **Pour le médecin référent** : double canal de notification — push + email — fiabilité supérieure pendant les gardes.
- **HDS** : email reste dans la frontière française (Resend EU) — pas de leak transatlantique.
- **RGPD** : email contient *uniquement* un lien deep-link et une mention générique ; aucune PHI dans le corps.

### Contrainte sécurité

L'email **NE DOIT PAS** contenir :
- Glucose value, ketone value, alert type, severity (en clair)
- Nom / prénom / DDN du patient
- Données médicales libres (`notes`, `resolutionNotes`)

Il **PEUT** contenir :
- Identifiant interne anonymisé du patient (ex: `Patient #1234`)
- Lien deep-link `https://app.diabeo.fr/dashboard/emergencies/{id}` (auth requise au clic)
- Mention « alerte critique en attente — connectez-vous pour voir les détails »

---

## ✅ Critères d'acceptation

### AC-1 — Email envoyé sur critical + flag activé

```gherkin
Étant donné un patient avec AlertThresholdConfig.notifyDoctorEmail = true
Et le patient a un PatientReferent.pro lié à un User avec email valide
Quand une alerte severity="critical" est émise (severe_hypo, severe_hyper, ketone_dka)
Alors un email est envoyé via emailService.sendDoctorEmergencyAlert
Et le sujet ne contient ni "DKA" ni "hypo" — formulation générique
Et le corps contient un deep link vers /dashboard/emergencies/{id}
Et un AuditLog est créé avec action="EMAIL_SENT", resource="EMERGENCY_ALERT"
```

### AC-2 — Email NON envoyé sur warning

```gherkin
Étant donné un patient avec notifyDoctorEmail = true
Quand une alerte severity="warning" est émise (hypo, hyper, ketone_moderate, manual)
Alors aucun email n'est envoyé (warning = push only par défaut)
```

### AC-3 — Email NON envoyé si flag désactivé

```gherkin
Étant donné un patient avec notifyDoctorEmail = false
Quand une alerte severity="critical" est émise
Alors aucun email n'est envoyé
Et le push FCM est envoyé (notifyDoctorPush=true par défaut)
```

### AC-4 — Pas de PHI dans le contenu

```gherkin
Étant donné un email d'alerte critique a été envoyé
Quand on inspecte le corps + sujet (HTML + texte)
Alors aucun mot-clé PHI n'apparaît : "hypo", "hyper", "DKA", "glucose", "cetone"
Et aucune valeur numérique en mg/dL ou mmol/L
Et aucun prénom/nom/DDN du patient
```

### AC-5 — Best-effort (n'arrête jamais le flux alerte)

```gherkin
Étant donné Resend renvoie une erreur (5xx, timeout)
Quand emergencyService.notifyCriticalAlert tente l'envoi email
Alors l'erreur est loggée via logger.error mais l'alerte reste créée
Et le push FCM est tenté indépendamment
```

---

## 📐 Règles métier

- **RM-1** : email **uniquement sur severity=critical** (jamais warning ni info).
- **RM-2** : un email est envoyé par référent identifié (`PatientReferent.pro.userId`). Pas de fan-out multi-référents (V1).
- **RM-3** : contenu strictement générique (cf. AC-4). Toute PHI dans email = bug bloquant.
- **RM-4** : best-effort — un échec email ne bloque jamais la persistance de l'alerte ni l'envoi push.
- **RM-5** : audit log `EMAIL_SENT` ne doit pas contenir le contenu du mail.

---

## 🔌 Impact technique

### Service à compléter

`src/lib/services/email.service.ts` — ajouter une méthode :

```typescript
async sendDoctorEmergencyAlert(input: {
  doctorEmail: string
  alertId: number
  patientInternalId: number  // ID interne, jamais nom
}): Promise<EmailResult>
```

Contenu HTML :
- Titre : « Diabeo — Alerte patient en attente »
- Corps : « Une alerte clinique nécessite votre attention. Connectez-vous au backoffice pour voir les détails. »
- CTA : `https://${DOMAIN}/dashboard/emergencies/{alertId}`
- Footer : `Diabeo — Hébergement HDS certifié — OVHcloud GRA`

### Service à modifier

`src/lib/services/emergency.service.ts` — dans `notifyCriticalAlert`, après le push FCM :

```typescript
if (alertConfig?.notifyDoctorEmail && alert.severity === "critical") {
  // Récupérer email du référent (déchiffré, jamais loggué)
  const referent = await prisma.patientReferent.findUnique({
    where: { patientId: alert.patientId },
    select: { pro: { select: { userId: true, user: { select: { email: true } } } } },
  })
  const referentEmail = referent?.pro?.user
    ? safeDecryptField(referent.pro.user.email)
    : null
  if (referentEmail) {
    void emailService.sendDoctorEmergencyAlert({
      doctorEmail: referentEmail,
      alertId: alert.id,
      patientInternalId: alert.patientId,
    })
  }
}
```

### Test obligatoire

- Un test snapshot du HTML/texte qui assert l'absence des mots-clés PHI listés en AC-4.
- Un test integration avec mock Resend qui assert que `RESEND_API_KEY` non configuré → `logger.error` mais pas de throw.

---

## 🧪 Plan de test

- Unit `email.service.test.ts` : nouvelle méthode + assertion absence PHI.
- Unit `emergency.service.test.ts` : branche `notifyDoctorEmail` + branche email échec ≠ alerte créée.
- Integration : avec `notifyDoctorEmail=true`, severity=critical, vérifier 1 appel Resend mock + audit log.

---

## 📦 Définition de Done

- [ ] Code review approuvée + healthcare-security-auditor PHI-leak check
- [ ] Tests verts (unit + integration)
- [ ] AuditLog `EMAIL_SENT` enregistré
- [ ] Snapshot HTML/text email vérifié sans PHI
- [ ] Documentation `email.service.ts` mise à jour
- [ ] Variable d'environnement `RESEND_API_KEY` documentée

---

## 🔗 US liées

- US-2074 (email transactionnel Resend) — base existante
- US-2224 / US-2230 (Mirror MVP émission alertes) — origine
- US-2076 (messagerie sécurisée) — V1+, alternative MSSanté pour les médecins équipés
