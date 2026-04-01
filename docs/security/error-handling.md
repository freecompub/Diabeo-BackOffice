# Gestion des erreurs critiques

## Principes

1. Ne JAMAIS exposer de stack traces ou messages internes dans les reponses API
2. Ne JAMAIS logger de donnees patient dans les erreurs
3. Toujours retourner un code d'erreur camelCase standardise
4. Logger uniquement `error.message` (pas l'objet complet)

## Codes d'erreur API

### Authentification

| Code | HTTP | Description |
|------|------|-------------|
| invalidCredentials | 401 | Email ou mot de passe incorrect |
| tokenExpired | 401 | JWT expire |
| tokenInvalid | 401 | JWT invalide (signature, format) |
| sessionRevoked | 401 | Session revoquee (logout) |
| unauthorized | 401 | Pas de token fourni |
| forbidden | 403 | Role insuffisant |
| mfaRequired | 403 | MFA active mais pas verifie |
| tooManyAttempts | 429 | Rate limit depasse |

### RGPD

| Code | HTTP | Description |
|------|------|-------------|
| gdprConsentRequired | 403 | Consentement RGPD non donne |
| sharingDisabled | 403 | Patient a desactive le partage avec les soignants |
| passwordRequired | 400 | Confirmation mot de passe requise pour suppression |

### Donnees

| Code | HTTP | Description |
|------|------|-------------|
| validationFailed | 400 | Validation Zod echouee (details inclus) |
| patientNotFound | 404 | Patient inexistant ou supprime |
| settingsNotFound | 404 | Parametres insulinotherapie non trouves |
| eventNotFound | 404 | Evenement diabete non trouve |
| documentNotFound | 404 | Document non trouve |
| appointmentNotFound | 404 | Rendez-vous non trouve |
| pregnancyNotFound | 404 | Grossesse non trouvee |
| proposalNotFound | 404 | Proposition non trouvee |
| syncNotFound | 404 | Sync device non trouvee |
| registrationNotFound | 404 | Enregistrement push non trouve |
| proNotFound | 404 | Professionnel non trouve |
| serviceNotFound | 404 | Service de sante non trouve |

### Limites

| Code | HTTP | Description |
|------|------|-------------|
| maxDevicesReached | 400 | Maximum 9 appareils atteint |
| invalidMimeType | 400 | Type de fichier non autorise |
| fileTooLarge | 400 | Fichier > 50 MB |
| valueOutOfBounds | 400 | Valeur hors bornes cliniques |

### Systeme

| Code | HTTP | Description |
|------|------|-------------|
| serverError | 500 | Erreur interne (details jamais exposes) |
| serverUnavailable | 503 | Service temporairement indisponible |

## Pattern d'erreur dans les routes

```typescript
try {
  const user = requireAuth(req)
  // ... logique metier
} catch (error) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  if (error instanceof Error && error.message === "specificError") {
    return NextResponse.json({ error: "specificError" }, { status: 404 })
  }
  // JAMAIS logger l'objet error complet — peut contenir des PII
  const msg = error instanceof Error ? error.message : "Unknown error"
  console.error("[route-name]", msg)
  return NextResponse.json({ error: "serverError" }, { status: 500 })
}
```

## Erreurs critiques — securite patient

| Scenario | Comportement attendu | Risque si absent |
|----------|---------------------|-----------------|
| ISF ou ICR = 0 | Throw Error avant division | Dose de 25U (max cap) sur donnees corrompues |
| Glycemie < 70 mg/dL | `requiresHypoTreatmentFirst = true` | Bolus pendant hypoglycemie |
| Dose > 25U | Plafonnement + `wasCapped` flag | Surdosage insuline |
| Patient supprime | Soft-delete filter partout | Acces donnees anonymisees |
| Consentement RGPD retire | 403 sur toutes les routes sante | Traitement illegal de donnees |
