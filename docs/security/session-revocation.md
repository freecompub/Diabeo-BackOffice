# Session Revocation — Architecture et Sécurité

## Contexte réglementaire

- **HDS ISO 27001 A.9.4.2** : Procédures de connexion sécurisées
- **ANSSI RGS v2.0 Section 5.2** : Gestion des sessions
- **RGPD Article 17** : Droit à l'effacement (implique la terminaison des sessions)

## Architecture

### Flux de révocation

```
POST /api/auth/logout
  ├── verifyJwt(token)                    # Vérifie signature RS256
  ├── invalidateSession(sid)              # Supprime session PostgreSQL
  ├── revokeSession(sid, ttlSeconds)      # Écrit dans Redis (Upstash)
  └── auditService.log(LOGOUT, status)    # Audit avec revocationStatus
```

### Vérification (chaque requête)

```
Middleware Edge (middleware.ts)
  ├── jwtVerify(token)                    # Signature + expiration
  ├── isSessionRevoked(sid)               # Lookup Redis (Upstash REST/HTTP)
  │   ├── Trouvé → 401 sessionRevoked
  │   ├── Non trouvé → Continuer
  │   └── Redis down → 401 (fail-closed)
  └── Injecte x-user-id, x-user-role
```

### Refresh endpoint (defense-in-depth)

```
POST /api/auth/refresh
  ├── verifyJwtAllowExpired(token)        # Vérifie signature (1h grace)
  ├── isSessionRevoked(sid)               # ← Check Redis AVANT refresh
  ├── getSession(sid)                     # ← Check PostgreSQL
  └── signJwt(newPayload)                 # Nouveau JWT si tout ok
```

## Décisions de sécurité

### Fail-closed (HDS compliance)

Si Redis est **indisponible** pendant un check de révocation, la session est considérée comme **révoquée** (requête rejetée). Ceci garantit qu'une panne Redis ne peut pas être exploitée pour contourner l'invalidation de session.

**Trade-off** : une panne Redis bloque tout le trafic authentifié. Mitigé par :
1. Upstash SLA 99.99% avec redondance régionale
2. Phase 2 (JWT court 15min) réduira la fenêtre d'impact
3. En dev/test (Redis non configuré), le check est skippé

### Redis non configuré (dev/test)

Si `UPSTASH_REDIS_REST_URL` ou `UPSTASH_REDIS_REST_TOKEN` ne sont pas définis :
- `revokeSession()` → retourne `false`, log console.error
- `isSessionRevoked()` → retourne `false` (pas de blocage en dev)

En production, ces variables **DOIVENT** être configurées.

### TTL des clés Redis

- Calculé à partir de `payload.exp - now` (temps restant du JWT)
- Minimum 60 secondes (protection contre clock drift)
- Default 24h (si exp absent — ne devrait pas arriver)
- Les clés expirent automatiquement → pas de croissance mémoire non bornée

### Révocation bulk (invalidateAllUserSessions)

Utilisée lors de :
- Désactivation de compte par un admin
- Suppression RGPD (Art. 17)
- Changement de rôle

Processus :
1. Récupère tous les `sid` de l'utilisateur en base
2. Révoque chaque `sid` dans Redis via `revokeSession()`
3. Supprime les sessions PostgreSQL

### Préfixe Redis

Format : `{REDIS_KEY_PREFIX}revoked:{sid}`

- Par défaut : `diabeo:prod:revoked:{sid}`
- Configurable via `REDIS_KEY_PREFIX` (ex: `diabeo:staging:`)
- Évite les collisions en multi-environnement sur un Redis partagé

## Variables d'environnement

| Variable | Requis (prod) | Description |
|----------|---------------|-------------|
| `UPSTASH_REDIS_REST_URL` | Oui | URL REST de l'instance Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Oui | Token d'authentification Upstash |
| `REDIS_KEY_PREFIX` | Non | Préfixe des clés (default: `diabeo:prod:`) |

## Fichiers concernés

| Fichier | Rôle |
|---------|------|
| `src/lib/auth/revocation.ts` | Client Redis, revokeSession, isSessionRevoked |
| `src/middleware.ts` | Check revocation dans le middleware Edge |
| `src/lib/auth/session.ts` | invalidateAllUserSessions (bulk revocation) |
| `src/app/api/auth/logout/route.ts` | Logout avec revocation + audit status |
| `src/app/api/auth/refresh/route.ts` | Check revocation avant refresh |
| `tests/unit/revocation.test.ts` | 10 tests (write, read, fail-closed, TTL) |

## Backlog

- [ ] **JWT court-lived (15min)** — Réduire `TOKEN_EXPIRY` de 24h à 15min, defense-in-depth
- [ ] **Rate limiter → Redis** — Même bug cross-runtime que la revocation (in-memory Map)
- [ ] **Health check Redis** — Endpoint monitoring pour alerter sur indisponibilité
