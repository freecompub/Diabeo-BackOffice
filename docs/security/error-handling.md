# Gestion des erreurs critiques

## Principes

1. Ne JAMAIS exposer de stack traces ou messages internes dans les reponses API
2. Ne JAMAIS logger de donnees patient dans les erreurs
3. Toujours retourner un code d'erreur camelCase standardise
4. Logger uniquement `error.message` (pas l'objet complet)

## Codes d'erreur API

### Authentification

| Code | HTTP | Description | UI/Frontend handling |
|------|------|-------------|---------------------|
| invalidCredentials | 401 | Email ou mot de passe incorrect | LoginForm shows error badge, clears password, focus email |
| tokenExpired | 401 | JWT expire | useAuth() initiates logout, redirect /login |
| tokenInvalid | 401 | JWT invalide (signature, format) | useAuth() treats as sessionRevoked, force logout |
| sessionRevoked | 401 | Session revoquee (logout) | useAuth() redirect /login, clear httpOnly cookie (browser) |
| unauthorized | 401 | Pas de token fourni | useAuth() redirect /login, middleware intercepts dashboard pages |
| forbidden | 403 | Role insuffisant | ClinicalBadge shows "Access Denied" red alert |
| mfaRequired | 403 | MFA active mais pas verifie | LoginForm shows MFA input form (Phase 9) |
| tooManyAttempts | 429 | Rate limit depasse (3 echecs) | LoginForm shows lockout timer (5/15/60min backoff), disabled submit |

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

## Middleware Page Protection (Phase 8)

### Comportement middleware étendu

Depuis Phase 8, le middleware protège **à la fois** les API routes et les pages dashboard.

**Matrice de protection:**

| Path | JWT requis | Action si manquant | Redirect |
|------|------------|--------------------|----------|
| `/api/**` (sauf `/api/auth/*`) | Oui | NextResponse 401 | N/A (API) |
| `/dashboard/**` | Oui | Redirect response | `/login?from=/dashboard/patients` |
| `/(auth)/**` | Non | Accès direct | N/A |
| `/login` | Non (logique interne) | Accès direct | N/A |

**Code middleware:**
```typescript
// src/middleware.ts
import { jwtVerify } from '@jose/jwt'

const secretKey = new TextEncoder().encode(process.env.JWT_PUBLIC_KEY!)

export async function middleware(req: Request) {
  const token = req.cookies.get('authToken')?.value || 
                req.headers.get('authorization')?.replace('Bearer ', '')

  // Protège /dashboard/**
  if (req.nextUrl.pathname.startsWith('/dashboard')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', req.url))
    }
    try {
      await jwtVerify(token, secretKey)
    } catch {
      return NextResponse.redirect(new URL('/login', req.url))
    }
  }

  // Protège /api/** (sauf /api/auth/*)
  if (req.nextUrl.pathname.startsWith('/api') && 
      !req.nextUrl.pathname.startsWith('/api/auth')) {
    if (!token) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    try {
      await jwtVerify(token, secretKey)
    } catch {
      return NextResponse.json({ error: 'tokenInvalid' }, { status: 401 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*']
}
```

### httpOnly Cookie auth

Token JWT stocké en httpOnly cookie (XSS protection):
- Name: `authToken`
- HttpOnly: `true` (JavaScript ne peut pas accéder)
- Secure: `true` (HTTPS only)
- SameSite: `Strict` (CSRF protection)
- MaxAge: 86400s (24h, Phase 9: réduire à 900s + refresh token)

**Login response (Set-Cookie header):**
```
Set-Cookie: authToken=eyJhbGc...; HttpOnly; Secure; SameSite=Strict; Max-Age=86400; Path=/
```

### useAuth Hook — Integration

```typescript
// Hook automatiquement gère les redirects
const { user, isAuthenticated } = useAuth()

if (!isAuthenticated) {
  // Middleware aura déjà redirigé, mais hook peut être utilisé pour pre-render fallback
  return <LoadingSpinner />
}

return <Dashboard user={user} />
```

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
