# Guide developpeur — Onboarding

## Prerequis

- Node.js 22+
- pnpm 10+
- Docker (pour PostgreSQL local)
- Git

## Installation

```bash
git clone https://github.com/freecompub/Diabeo-BackOffice.git
cd Diabeo-BackOffice
pnpm install
```

## Configuration

Copier `.env.example` en `.env` et remplir :

```bash
cp .env.example .env
```

Variables obligatoires :

| Variable | Description | Generation |
|----------|-------------|-----------|
| DATABASE_URL | PostgreSQL connection string | Docker Compose |
| HEALTH_DATA_ENCRYPTION_KEY | AES-256-GCM (32 bytes hex) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| HMAC_SECRET | HMAC-SHA256 pour email | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| JWT_PRIVATE_KEY | RSA privee PEM | `openssl genrsa -out private.pem 2048` |
| JWT_PUBLIC_KEY | RSA publique PEM | `openssl rsa -in private.pem -pubout -out public.pem` |

## Lancement local

```bash
# Demarrer PostgreSQL
docker compose --profile local up -d

# Generer le client Prisma
pnpm prisma generate

# Appliquer les migrations
pnpm prisma migrate dev

# Injecter les donnees de test
pnpm prisma db seed

# Demarrer le serveur
pnpm dev
```

## Tests

```bash
pnpm test              # Tests unitaires (Vitest)
pnpm test:coverage     # Avec couverture (seuils: 80/75/80/80)
pnpm test:e2e          # Tests E2E (Playwright)
pnpm lint              # ESLint
npx tsc --noEmit       # TypeScript check
```

## Workflow PR

1. Creer une branche : `git checkout -b feat/ma-feature`
2. Developper avec tests (couverture >= 80%)
3. Verifier : `pnpm test && pnpm lint && npx tsc --noEmit`
4. Push et creer la PR
5. Attendre la CI verte
6. Review par les agents (code-reviewer, typescript-pro, nextjs-developer, test-automator)
7. Corrections des findings
8. Validation par le maintainer
9. Merge

## Conventions de code

### Erreurs API

Format camelCase uniforme :

```json
{ "error": "validationFailed", "details": { ... } }
{ "error": "patientNotFound" }
{ "error": "gdprConsentRequired" }
{ "error": "forbidden" }
{ "error": "serverError" }
```

### Services

- Un service par domaine metier (`patient.service.ts`, `insulin.service.ts`, ...)
- Decouple de Next.js — pas d'import de `NextRequest`/`NextResponse`
- Mutations dans `$transaction` avec `auditService.logWithTx`
- Retourner des objets serialisables (pas de Prisma Decimal/BigInt bruts)

### Routes API

- Utiliser `NextRequest` (pas `Request`)
- `requireAuth` ou `requireRole` en premier
- `requireGdprConsent` sur les routes donnees de sante
- `resolvePatientId` pour supporter patient + pro
- `extractRequestContext` pour audit IP/UA
- Zod validation avant appel service
- `console.error` avec `error.message` uniquement (jamais l'objet complet)

### Chiffrement

- Utiliser `encryptField`/`safeDecryptField` de `@/lib/crypto/fields`
- `safeDecryptField` retourne `null` en cas d'echec (jamais le ciphertext)
- Champs a chiffrer listes dans `ENCRYPTED_USER_FIELDS` et `ENCRYPTED_MEDICAL_FIELDS`

## Structure des tests

```
tests/
├── unit/              # Tests unitaires (services, crypto, auth)
├── integration/       # Tests d'integration (API routes mockees)
├── e2e/               # Tests E2E (Playwright, navigateur)
└── helpers/
    ├── prisma-mock.ts # Mock Prisma (vitest-mock-extended)
    └── setup.ts       # Variables d'environnement de test
```

Pattern de test transaction :

```typescript
const mockTx = {
  model: { create: vi.fn().mockResolvedValue({ id: 1 }) },
  auditLog: { create: vi.fn().mockResolvedValue({}) },
}
prismaMock.$transaction.mockImplementation(
  (async (cb: any) => cb(mockTx)) as any
)
```
