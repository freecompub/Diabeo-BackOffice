# DPIA — Sécurité de session & révocation immédiate (US-2621 + F7/US-2619)

**Statut** : Brouillon — à signer DPO + RSSI avant mise en service patients réels.
**Périmètre (PR2)** : `User.authVersion` + claim JWT `av` ; re-validation statut/`av`
au refresh ; **mono-session** backoffice ; **timeout d'inactivité** (session glissante
Redis) ; révocation immédiate des droits.
**Lié à** : `dpia-access-foundations.md` (socle PR1), `prerequis-techniques-securite-us.md`
(F7), `gestion-personnel-droits-us.md` (mono-session).

## 1. Contrainte d'architecture

Le **middleware ne lit pas la base** (Edge-compatible : `jose` + Upstash Redis HTTP,
aucun Prisma). Conséquence des choix :
- **Révocation immédiate** = **Redis** (clé `revoked:<sid>`, déjà en place, fail-closed).
- **Re-validation DB** (statut, `authVersion`) = endpoint **`/api/auth/refresh`** (Node,
  cadence ~15 min).
- **Inactivité** = **session glissante Redis** (`sess:<sid>`), rafraîchie par le
  middleware à chaque requête (vraie activité, **zéro écriture DB**).

## 2. F7 — révocation immédiate de capacité/rôle (US-2619)

- `User.authVersion` (défaut 1) recopié dans le claim JWT `av`. Tout changement de
  droits/statut **bumpe** `authVersion` (incrément inline dans la même `user.update`
  que `userManagementService.updateRole` & `setStatus`).
- **Effet immédiat** : à chaque changement, les sessions actives sont **révoquées**
  (`invalidateAllUserSessions` → Redis `revoked:<sid>` + `sess:<sid>` effacés) → la
  requête suivante est refusée par le middleware (≤ 1 requête). ⚠️ Cette immédiateté
  « ≤ 1 requête » est **conditionnée au succès de l'écriture Redis** : si elle échoue
  (outage), le middleware (qui n'interroge pas la DB) laisse passer le token jusqu'au
  prochain refresh. La **borne garantie** est donc le refresh (≤ 15 min), ci-dessous.
  Tout échec d'écriture est loggé (alerting ops du window dégradé).
- **Filet de sécurité** : si un `sid` échappe à la révocation (Redis momentanément KO
  à l'écriture), le **refresh** rejette un token dont `av ≠ User.authVersion`
  (`authVersionStale`) et un compte `status ≠ active` (`accountSuspended`).
- Back-compat : un token pré-PR2 sans `av` → `av = 0` → forcé à se réémettre au refresh.

## 3. US-2621 — mono-session backoffice

- Au **login** et au **MFA challenge**, un rôle backoffice (`ADMIN/DOCTOR/NURSE`)
  **invalide ses sessions précédentes** avant d'en créer une nouvelle (dernier
  appareil gagne). **`VIEWER` (patient) exempté** (multi-appareils).
- Bénéfices : empêche le **partage de compte**, réduit la fenêtre d'un token volé,
  simplifie la révocation (un seul `sid` à invalider).

## 4. US-2621 — timeout d'inactivité (session glissante Redis)

- Clé `sess:<sid>` créée au login/MFA (`startActivity`, TTL = fenêtre) puis
  **rafraîchie à chaque requête** par le middleware (`slideActivity`, `SET … EX … XX`).
  Si la clé a expiré (aucune requête pendant la fenêtre) → `timedOut` → accès coupé
  (401 `sessionInactivityTimeout` API ; redirect `/login` + cookie effacé pour les pages).
- Fenêtres : **30 min** backoffice, **15 min** `ADMIN` (renforcé) ; `VIEWER` non soumis.
- **Vraie inactivité par requête** (pas un `lastSeenAt` DB) : 1 op Redis/requête, aucune
  écriture base. Le rafraîchissement de token en tâche de fond **ne compte pas** comme
  activité (le endpoint refresh est hors du périmètre du slide) → un onglet ouvert mais
  inactif est bien déconnecté dès la reprise d'activité réelle.

## 5. Durées

JWT **15 min** + session DB **24 h** conservés (cap absolu) ; l'inactivité glissante
gouverne la durée pratique. `verifyJwtAllowExpired` (grâce 15 min) conservé : un
changement de droits pendant la grâce est rattrapé au refresh (`av`/statut).

## 6. ⚠️ Risques / notes de déploiement

- **Re-login unique au déploiement** : les sessions backoffice existantes n'ont pas de
  clé `sess:<sid>` → premier passage middleware `slideActivity` (XX) échoue → **une
  reconnexion forcée**. Acceptable pour une release sécurité (+ la mono-session change
  déjà la donne). À communiquer aux utilisateurs.
- **Redis indisponible** → **fail-closed** (posture HDS déjà en place) : `isSessionRevoked`
  et `slideActivity` renvoient « bloqué » → accès coupé, **jamais de bypass**. Un outage
  Redis bloque le trafic authentifié (mitigé par la criticité backoffice + alerting ops).
- **Refresh non soumis au slide** : un token peut être réémis pour une session inactive,
  mais il reste **inutilisable** sur les routes protégées (le slide middleware les coupe).
  Choix assumé (le refresh de fond ne doit pas compter comme activité).
- **F1 / `ADMIN` PHI** : inchangé, reporté V4 (cf. `dpia-access-foundations.md`).

## 7. Tests

- `tests/unit/activity.test.ts` (fenêtres par rôle ; slide active/timedOut/fail-closed ;
  start/clear ; Redis off → skip).
- `tests/unit/jwt.test.ts` (claim `av` ; back-compat token legacy → `av=0`).
- `tests/unit/user-management.service.test.ts` (bump `authVersion` + révocation sessions
  sur updateRole/setStatus).
- `tests/integration/middleware-inactivity.test.ts` (timeout page → redirect /login +
  cookie effacé ; anti-boucle).
- `tests/integration/api-auth-refresh.test.ts` (révoqué / suspendu / `av` périmé / nominal).
- Non-régression : suite complète verte (login/mfa/logout/middleware inclus).

## 8. Validations à obtenir

- [ ] DPO : mono-session backoffice + exemption patient (§3) ; inactivité glissante (§4).
- [ ] RSSI : fail-closed Redis (§6), révocation immédiate (§2), durées (§5), re-login déploiement.
- [ ] Ops : communication re-login au déploiement ; alerting outage Redis.

---

*Dernière mise à jour : 2026-06-17 — DPIA initiale sécurité de session (PR2 : F7
révocation immédiate + mono-session + timeout d'inactivité glissant).*
