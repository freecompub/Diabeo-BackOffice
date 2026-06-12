# Résolution de l'IP client (X-Forwarded-For) — durcissement transverse

> **Statut** : backlog sécurité (MEDIUM). Identifié en revue PR #531 (round 3) par
> le `healthcare-security-auditor`. **Pré-existant** — non introduit par cette PR.

## Problème

`extractRequestContext` (`src/lib/services/audit.service.ts`) résout l'IP client ainsi :

```ts
const ipAddress =
  headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
  headers.get("x-real-ip") ??
  "unknown"
```

Le **premier** segment de `x-forwarded-for` (hop **le plus à gauche**) est la valeur
**que le client contrôle** : seul le hop ajouté par notre proxy de confiance (OVH GRA
reverse proxy) en bout de chaîne est fiable. Conséquences :

1. **Rate-limit per-IP évadable** — un attaquant authentifié peut envoyer
   `X-Forwarded-For: 1.2.3.4` différent à chaque requête → chaque IP usurpée =
   budget neuf (bucket `patientDataReadIp`). Le bucket per-IP devient une
   défense en profondeur partielle. *Le bucket per-**user** (60/60s) borne la
   menace réaliste (1 compte PS compromis qui scrape).*
2. **IP des audit logs spoofable** — impact **forensique HDS/CNIL/ANS** : l'IP
   tracée dans `audit_logs` n'est pas fiable tant que ce point n'est pas corrigé.

## Pourquoi ce n'est PAS corrigé dans la PR #531

La correction touche la résolution d'IP de **tout** le backoffice (toutes les
routes + tous les audit logs), et dépend de la **topologie proxy réelle** (nombre
de hops de confiance devant l'app, OVH positionne-t-il `x-real-ip` ?). La corriger
à l'aveugle risquerait de **corrompre la forensique d'audit de toute l'application**.
C'est un chantier transverse, hors du périmètre « combobox RDV ».

## Correction recommandée (ticket dédié)

1. Confirmer la topologie OVH GRA : nombre de proxies de confiance, présence et
   fiabilité de `x-real-ip`.
2. Résoudre l'IP depuis le **hop de confiance** (rightmost trusted hop) via un
   `TRUSTED_PROXY_COUNT` configurable, **de façon cohérente pour l'audit ET le
   rate-limit** (point unique dans `extractRequestContext`).
3. Ajouter un test : un `X-Forwarded-For` client-supplied ne doit pas changer
   l'IP résolue derrière N proxies de confiance.

## Mitigations en place en attendant

- Bucket rate-limit **per-user** (borne la menace post-auth réaliste).
- Bucket per-IP en **fail-open** + **skip** quand l'IP = `"unknown"` (pas de
  bucket partagé `ip:unknown`), cf. `src/app/api/patients/search/route.ts`.
- La **confidentialité** ne repose pas sur le rate-limit mais sur le **RBAC**
  (`accessibleIds`) — non affecté par le spoofing d'IP.
