# Messaging Mobile Contract — US-2076 scope A

> Contract iOS/web pour les 5 routes `/api/messages` — comportements
> RGPD/HDS critiques pour le handling client. **MED-3 CR review round 4**.

## Routes

| Verbe | Endpoint | Description |
|---|---|---|
| GET | `/api/messages` | Liste threads (inbox) |
| POST | `/api/messages` | Envoie un message |
| GET | `/api/messages/unread-count` | Badge unread (polling 60s) |
| GET | `/api/messages/thread/[conversationKey]` | Fetch thread paginé |
| PUT | `/api/messages/[id]/read` | Marque message lu |

## Codes de retour HTTP

| Status | Signification | Action client |
|---|---|---|
| 200 | OK | Process payload |
| 201 | Created (POST send) | Process `{message: {id, ...}}` |
| 400 | Bad request (Zod query param fail sur GET) | Affiche erreur dev, ne logout pas |
| 401 | Unauthenticated | Redirect login |
| 403 `gdprConsentRequired` | **Consent RGPD révoqué** | **NE PAS logout** — afficher modal "Réactivez votre consent dans Préférences" |
| 403 `forbidden` | RBAC fail (cabinet, referent, etc.) | Afficher "Accès refusé", logger pour SOC |
| 404 | Thread/message introuvable OU non-participant (anti-énumération) | Treat as "n'existe pas pour vous" |
| 415 | Content-Type non-JSON | Bug client, fixer headers |
| 422 | Validation Zod body OU service-level | Afficher détails `details.fieldErrors` |
| 429 | Rate limit 100 msgs/min/user | Honorer `Retry-After` header |
| 500 | Erreur serveur | Retry avec backoff |

### Cas critique : `403 gdprConsentRequired` vs `403 forbidden`

Les deux retournent HTTP 403, le **discriminator est `body.error`** :

```json
// Consent révoqué — restaurer via /api/account/privacy
{ "error": "gdprConsentRequired" }

// RBAC métier (pas referent, pas même cabinet, etc.)
{ "error": "forbidden", "reason": "..." }
```

iOS/web error handler doit brancher sur `body.error` :

```typescript
if (res.status === 403) {
  const body = await res.json()
  if (body.error === "gdprConsentRequired") {
    // PAS de logout — propose réactivation consent
    showConsentReactivationModal()
    return
  }
  // RBAC fail générique — affiche message neutre
  showAccessDeniedModal()
}
```

## FCM data payload (push notifications)

**Contenu garanti** :
```json
{
  "type": "message",
  "nonce": "<UUID v4 opaque>"
}
```

Anti-leak Google FCM (Cloud Act) :
- **JAMAIS** : `conversationKey`, `messageId`, `fromUserId`, `toUserId`, plaintext.
- Le `nonce` est généré côté serveur, **non-corrélable** au `messageId` DB.

**Flow client** :
1. FCM push reçu avec `type=message + nonce`.
2. Client affiche notification système (`title: "Nouveau message"`, `body: "[message chiffré]"`).
3. Sur tap notification → `GET /api/messages` ou `/unread-count` (authentifié) pour fetch l'inbox réelle.
4. Dedup côté client par `conversationKey + createdAt` (pas par `nonce`, qui est ephémère).

## Polling unread-count

- Fréquence recommandée : **60 secondes** (cohérent avec architecture US-2076 scope A).
- Backoff : si `429 rateLimitExceeded` (rare car endpoint léger), honorer `Retry-After`.
- Si `403 gdprConsentRequired` → arrêter le polling, ne PAS logout, afficher banner.

## Sécurité corps des messages

- Le `body` (POST) est **chiffré côté serveur** (AES-256-GCM) avant insert.
- Le client envoie le plaintext en HTTPS (TLS 1.3) — pas de chiffrement E2E V1.
- Cap : 8164 octets UTF-8 (vérifier `Buffer.byteLength(body, "utf8")` côté client).

## Erreurs validation

| Champ | Bornes | Erreur |
|---|---|---|
| `toUserId` | Int positif | 422 `validationFailed` field=toUserId |
| `body` | 1-8164 octets UTF-8 | 422 `validationFailed` field=body |
| `cursor` | cuid valide existant | 422 `validationFailed` field=cursor (NEW-M5 round 4) |
| `conversationKey` | 64 hex chars | 400 `validationFailed` |
| `[id]` (markRead) | cuid `^c[a-z0-9]{24}$` | 400 `validationFailed` |

## Cas anti-énumération

- `GET /thread/[key]` : 404 si l'utilisateur n'est pas participant. **Ne pas
  inférer** l'existence du thread.
- `PUT /[id]/read` : 404 si pas le destinataire. Un `accessDenied` audit
  est émis (US-2265 burst detection côté serveur).
- `POST /send` : 403 `forbidden` peut signifier (a) RBAC fail, (b)
  consent destinataire révoqué, (c) selfMessage, (d) patient↔patient.
  Le client ne doit PAS différencier ces cas (anti-énumération).

## Cache headers

Toutes les routes retournent `Cache-Control: no-store, private`. Les
clients web ne doivent pas mettre en cache (ni service workers, ni navigateur).
