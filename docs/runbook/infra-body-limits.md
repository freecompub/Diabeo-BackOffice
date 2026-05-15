# Runbook — Body size limits & reverse proxy hardening

> NEW-M3 (review re-2 PR #407) — Contrat infra côté reverse proxy.

## Contexte

Plusieurs routes API exposent un body cap applicatif via le helper
`assertBodySize(req, maxBytes)` (`src/lib/team-route-helpers.ts:167`).
Ce helper vérifie le header `Content-Length` et rejette en 413 si la
taille dépasse le cap.

**Limitation connue** : si le client envoie un body avec
`Transfer-Encoding: chunked` (HTTP/1.1) ou trames HTTP/2 sans
`Content-Length` déclaré, le helper laisse passer. Le service applicatif
applique alors ses propres caps (Zod `.max(N_ITEMS)`, `MAX_BULK_ITEMS`,
etc.), mais `req.json()` aura déjà buffer le body entier en mémoire
avant validation.

## Exigence reverse proxy

Le déploiement Diabeo (OVHcloud, Next.js standalone derrière nginx ou
Traefik) **doit** appliquer un cap au niveau du proxy pour défendre
contre les attaques mémoire :

### nginx

```nginx
# /etc/nginx/conf.d/diabeo.conf
client_max_body_size 10m;        # cap global
client_body_buffer_size 1m;
client_body_timeout 30s;
```

### Traefik (v2/v3)

```yaml
# traefik.yml
http:
  middlewares:
    body-limit:
      buffering:
        maxRequestBodyBytes: 10485760   # 10 MB
        memRequestBodyBytes: 1048576    # 1 MB
  routers:
    api:
      middlewares: [body-limit]
```

### OVH Load Balancer

Si le LB OVH est en front, configurer la limite globale via
`request_body_max_size = 10485760` (10 MB) dans la frontend.

## Caps applicatifs en place

| Route | Cap helper | Justification |
|-------|-----------:|---------------|
| `POST /api/billing/invoices/:id/pay` | (no cap, body petit) | Zod discriminated union accepte un body ~200 octets |
| `POST /api/patients/:id/activity` | **1 MB** | 1 entry manuelle ≤ ~2 KB |
| `PUT /api/patients/:id/activity/:activityId` | **200 KB** | PATCH partiel petit |
| `POST /api/patients/:id/activity/sync` | **5 MB** | 500 items × ~10 KB/item bornés |

## Recommandation

Le cap reverse proxy doit être >= 10 MB pour ne pas bloquer le sync
batch (`5 MB` + marge headers/encoding). Tout cap inférieur à 5 MB
casse les flows bulk sync mobile.

## Vérification

```bash
# Test : push 100 MB sans Content-Length, attendu 413 du proxy
curl -X POST https://staging.diabeo.fr/api/patients/1/activity/sync \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Transfer-Encoding: chunked" \
  --data-binary @/tmp/huge.json
# expected: HTTP/1.1 413 Request Entity Too Large
```

## Suivi

- Issue V1 : ajouter un check CI qui valide la config nginx/Traefik
  contre cette spec (`pnpm run check:infra-limits`).
- Si la limite proxy est plus basse que les caps applicatifs, le proxy
  est la source de vérité (sera atteint en premier).
