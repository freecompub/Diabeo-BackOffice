# US-2270 — Socle : environnement de dev entièrement mocké (offline, déterministe)

> Permettre de lancer l'application **100 % hors-ligne** (aucun service externe
> requis) pour dérouler la QA sur tous les domaines. Aujourd'hui ~70 % marche
> déjà en local (PostgreSQL + MinIO via `docker compose --profile local`,
> fallbacks mémoire Redis cache/idempotency, antivirus skip en dev). Cette US
> comble les 3 services qui **plantent en dur** sans credentials et pose un
> profil d'environnement mocké unique.

## 📊 Métadonnées

| Champ | Valeur |
|-------|--------|
| **ID** | `US-2270` |
| **Domaine** | 24. QA & Environnement de test |
| **Priorité** | **V1** |
| **Statut** | 🆕 À démarrer |
| **Story points** | **5** (Fibonacci) |
| **Dépendances** | docker-compose profil local · MinIO · clés crypto locales (tests/helpers/setup.ts) |

---


## 📋 Contexte

Services sans fallback (throw si env absent) → bloquent le dev offline :
- **Resend (email)** — `src/lib/services/email.service.ts` : throw `RESEND_API_KEY not configured`.
- **Firebase FCM (push)** — `src/lib/firebase/admin.ts` : throw si `FIREBASE_SERVICE_ACCOUNT_KEY` absent.
- **Redis revocation** — `src/lib/auth/revocation.ts` : pas de fallback mémoire (skip silencieux), ≠ cache/idempotency qui ont déjà un `memoryFallback`.

Déjà offline-capables (à conserver) : S3→MinIO, Redis cache/idempotency (Map mémoire), ClamAV (skip dev), crypto/JWT (clés locales).

## ✅ Critères d'acceptation

```gherkin
Scenario: démarrage 100 % offline sans aucun service externe
  Given docker compose --profile local (PostgreSQL + MinIO) lancé
  And un profil d'env "mock" (sans clés Resend/Firebase/Upstash)
  When je lance `pnpm dev`
  Then aucune route n'échoue en 500 faute de service externe
  And les emails partent vers un STUB (loggés, jamais envoyés)
  And les push FCM partent vers un STUB (file mémoire inspectable)
  And l'upload de document va sur MinIO (consultable + téléchargeable)
  And l'antivirus est neutralisé (clean=true) hors production
```

## 🛠️ Implémentation
- **Profil env** `.env.mock.dev` (gitignoré) : clés Resend/Firebase/Upstash vides → déclenche les fallbacks ; `OVH_S3_*` → MinIO localhost ; clés crypto de dev partagées avec `tests/helpers/setup.ts`.
- **Stubs** (gate `MOCK_MODE`/env absente, jamais en prod) : `email-stub` (console + messageId mock), `firebase-stub` (file mémoire + `getPushLog()` pour les tests), gate `MOCK_ANTIVIRUS`.
- **Redis revocation** : aligner sur le `memoryFallback` (cache/idempotency) pour un comportement déterministe offline.
- **Factory** `getEmailService()/getFirebaseService()` : vrai client si credentials, sinon stub.
- Doc `docs/local-development.md` : section « mode mocké complet ».

## 🔭 Hors périmètre
Enrichissement des données de seed par domaine → US-2271…US-2282 (une par domaine QA).

