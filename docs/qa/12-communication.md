# QA — Communication & écran legacy

Écrans : `/messages`, `/patient/appointments`, `/users` (legacy).
Voir [conventions](README.md#3-conventions--légende).

---

## Écran : Messagerie sécurisée (`/messages`) 🟢

**Rôle / RBAC** : NURSE+ (VIEWER redirigé `/login` + audit `accessDenied`).
Canaux : patient↔PS (si le PS encadre le patient via `PatientReferent`/`PatientService`),
staff↔staff (même cabinet), ADMIN. `self↔self` et `patient↔patient` interdits.
**Consentement RGPD bilatéral** (émetteur ET destinataire). **Corps chiffré AES-256-GCM.**
**Statut impl.** : 🟢 Réel (US-2076 scope A : REST + polling 60 s + FCM).

### Affichage attendu

| Élément | État attendu |
|---|---|
| En-tête (titre/sous-titre) | visible |
| Sidebar threads (320 px desktop) | recherche, filtre « Tous » / « Non lus », badge non-lus, « Patient #N » |
| Threads triés `lastMessage DESC` | visible |
| Viewer central + composer | si thread sélectionné |
| Badge non-lus (polling 60 s) | `GET /api/messages/unread-count` |
| États | loading, erreur, vide « Aucune conversation » |
| A11y | skip-link, `role=list`, `aria-current`, live region « X conversations / Y non lues », cibles ≥ 44 px |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Lister threads | `GET /api/messages?limit=100` | sidebar | lecture · `Cache-Control: no-store` · audit |
| Ouvrir thread | `GET /api/messages/thread/[conversationKey]` | messages affichés | lecture (participant requis sinon 404) · audit READ |
| Envoyer | `POST /api/messages` `{toUserId, body}` | message ajouté | INSERT `messages` (**bodyEnc chiffré**, `conversationKey`=HMAC) · **FCM data-only** · audit CREATE (`metadata.patientId`) |
| Marquer lu | `PUT /api/messages/[id]/read` | badge MAJ | UPDATE `read_at` (idempotent) · audit UPDATE |

> Validation envoi : `toUserId` entier positif, `body` 1–8164 **octets UTF-8**.
> Rate-limit 100 msg/min/user. Consentement requis aux 4 routes.

```gherkin
Feature: Messagerie sécurisée

  Scénario: un NURSE envoie un message à un patient qu'il encadre
    Étant donné que je suis connecté en tant que "NURSE"
    Et un patient que j'encadre avec consentement RGPD
    Quand j'envoie le message "Pensez à votre contrôle"
    Alors le message apparaît dans le fil
    # Effet base: INSERT messages(bodyEnc chiffré, conversationKey HMAC) + FCM + audit(CREATE/MESSAGE, metadata.patientId)

  Scénario: corps de message trop long
    Quand j'envoie un message de plus de 8164 octets
    Alors la réponse est 422
    # Effet base: AUCUNE insertion

  Scénario: destinataire ayant retiré son consentement (anti-énumération)
    Étant donné un destinataire ayant révoqué son consentement
    Quand je tente d'envoyer un message
    Alors la réponse est 403 "forbidden" (raison réelle masquée)
    # Effet base: audit serveur(accessDenied, kind=message.send.recipientConsentRevoked)

  Scénario: marquer un message comme lu est idempotent
    Quand je marque un message déjà lu
    Alors la réponse indique "alreadyRead"
    # Effet base: pas de double écriture
```

**Cas limites** : consentement bilatéral ; 429 rate-limit (`Retry-After`) ; non-participant → 404 (anti-énumération) ; `conversationKey` peppered (dump DB inexploitable seul) ; purge RGPD Art. 17 → thread sélectionné réinitialisé.

---

## Écran : Mes RDV (patient) (`/patient/appointments`) 🟢

**Rôle / RBAC** : **VIEWER strict** (layout patient + audit `accessDenied` si autre rôle).
Lecture seule : le patient voit ses RDV ; peut **accepter une alternative**.
**Consentement RGPD requis** (sinon redirection `/account/privacy`).
**Statut impl.** : 🟢 Réel (US-2500-UI).

### Affichage attendu

| Élément | État attendu |
|---|---|
| Deux sections : « Prochains RDV » (ASC) et « Passés » (DESC) | landmarks `<section>` |
| Par carte | date (longue, fr), heure HH:MM, type + durée + lieu, **badge statut** (couleurs Sérénité, `pending_validation` ambre WCAG AA) |
| « Alternative proposée : [date] » + bouton « Accepter alternative » | si `status=cancelled` + alternative proposée |
| États | loading, erreur « Impossible de charger » + dernière sync, vide |
| Toast action (succès/erreur) 4 s | aria-live |

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Charger mes RDV | `GET /api/appointments?from&to&patientId` | 2 sections | lecture · `canAccessPatient` (sinon `accessDenied`) · `Cache-Control: no-store` |
| Accepter alternative | `POST /api/appointments/[id]/accept-alternative` | RDV repasse « confirmé » | UPDATE `status=confirmed`, alternative effacée, `acceptedAt` · audit UPDATE |

```gherkin
Feature: RDV côté patient

  Scénario: le patient voit ses prochains RDV
    Étant donné que je suis connecté en tant que "VIEWER" avec consentement RGPD
    Quand je vais sur "/patient/appointments"
    Alors je vois la section "Prochains RDV"
    # Effet base: lecture seule (canAccessPatient) ; aucune écriture

  Scénario: accepter une alternative proposée
    Étant donné un de mes RDV annulé avec une alternative proposée
    Quand je clique "Accepter alternative"
    Alors le RDV repasse au statut "confirmé"
    # Effet base: UPDATE appointment(status=confirmed, acceptedAt, alternative effacée) + audit

  Scénario: alternative expirée
    Étant donné une alternative dont le délai est dépassé
    Quand je clique "Accepter alternative"
    Alors je vois "Délai dépassé"
    # Effet base: 423 alternativeExpired, aucune modif
```

**Cas limites** : VIEWER orphelin (`patientId=null`) → message unifié (anti-énumération) ; consentement absent → redirection ; 409 conflit de créneau ; 423 délai dépassé ; double-submit protégé par carte ; dates en UTC (contrat).

---

## Écran : Utilisateurs — alias legacy (`/users`) 🟢

**Statut impl.** : ✅ **A5 corrigé** — `/users` **redirige** désormais vers
`/admin/users` (la vraie UI de gestion des utilisateurs, voir [`06-admin.md`](06-admin.md)).
L'ancien stub « Bientôt disponible » est supprimé, et la **nav** (`NavigationShell`)
pointe directement sur `/admin/users` (elle envoyait auparavant l'admin vers le stub).

### Actions & effets

| Action | Endpoint | Effet visuel | Effet base |
|---|---|---|---|
| Aller sur `/users` | — (redirection serveur) | redirigé vers `/admin/users` | aucun |

```gherkin
Feature: Alias legacy /users

  Scénario: /users redirige vers la vraie UI d'administration
    Étant donné que je suis connecté en tant que "ADMIN"
    Quand je vais sur "/users"
    Alors je suis redirigé vers "/admin/users"

  Scénario: la nav admin pointe directement sur /admin/users
    Étant donné que je suis connecté en tant que "ADMIN"
    Alors l'item de nav « Utilisateurs » pointe sur "/admin/users"
```

**Cas limites** : le contrôle d'accès ADMIN est assuré par `/admin/users`
(un non-ADMIN atteignant `/users` est redirigé vers `/admin/users` puis,
faute de droit, vers `/`). Verrouillé par `tests/unit/users-legacy-redirect.test.tsx`
+ `tests/components/phase11/phase11-navigation.test.tsx`.
