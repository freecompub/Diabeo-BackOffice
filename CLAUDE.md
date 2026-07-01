# CLAUDE.md — Diabeo Backoffice

Fichier de contexte persistant pour Claude Code.
Mis à jour à chaque décision architecturale majeure.

---
@.claude/TEAM.md
@.claude/Documentation.md
---
## 🏥 Projet

**Diabeo** est une application de gestion de l'insulinothérapie pour les patients diabétiques.
Ce dépôt contient le **backoffice web** (Next.js) destiné aux médecins, infirmières et administrateurs.

L'application iOS Diabeo (Swift) est dans un dépôt séparé. Les modèles de données doivent rester
alignés entre les deux dépôts.

---

## 🏗️ Stack technique

| Couche         | Technologie                        | Version  |
|----------------|------------------------------------|----------|
| Framework      | Next.js (App Router)               | 16.x     |
| Langage        | TypeScript                         | strict   |
| UI             | shadcn/ui + Tailwind CSS           | latest   |
| ORM            | Prisma + `@prisma/adapter-pg`      | 7.x      |
| Base de données| PostgreSQL                         | 16       |
| Auth           | JWT RS256 custom (jose + bcryptjs) | —        |
| Chiffrement    | AES-256-GCM (Node.js crypto natif) | —        |
| Cache          | Upstash Redis                      | POC      |
| Fichiers       | OVH Object Storage (S3-compatible) | —        |
| Infra          | Docker Compose + OVHcloud GRA      | —        |

---

## 📁 Structure du projet

```
diabeo-backoffice/
├── src/
│   ├── app/        # Next.js App Router (groupes: (auth), (dashboard), api/)
│   ├── lib/        # Logique métier découplée — services, crypto, auth, db, storage
│   ├── components/ # ui/ (shadcn — NE PAS modifier) + diabeo/ (métier)
│   ├── hooks/      # React hooks (useAuth, etc.)
│   └── types/      # Module augmentations TS
├── prisma/         # schema.prisma (48 tables), migrations versionnées, seed.ts, sql/
├── tests/          # Vitest unit, Playwright E2E
├── docs/           # ROADMAP, runbook/, compliance/ (DPIA), security/, qa/, UserStory/
├── messages/       # i18n FR/EN/AR (next-intl)
└── graphify-out/   # Knowledge graph (voir section ci-dessous)
```

**Convention** : tout le code métier dans `src/lib/services/*.service.ts`, jamais dans les routes API.
Les routes `src/app/api/**/route.ts` ne font que : parse Zod → call service → format response.
## 🎨 Design system

### Palette de couleurs — "Sérénité Active"

```
Primaire (teal)    : #0D9488  → Actions principales, liens, titres
Secondaire (corail): #F97316  → Alertes, actions secondaires
Fond principal     : #FAFAFA
Fond secondaire    : #F3F4F6
Texte principal    : #1F2937
Texte secondaire   : #6B7280

Glycémie normale   : #10B981  (vert émeraude)
Glycémie haute     : #F59E0B  (orange ambre)
Glycémie critique  : #EF4444  (rouge)
```

### Composants UI

- Toujours utiliser **shadcn/ui** comme base (jamais réinventer des composants de base)
- Les composants métier Diabeo sont dans `components/diabeo/`
- Accessibilité obligatoire : ARIA labels sur tous les éléments interactifs
- Responsive : mobile-first, mais le backoffice est principalement desktop

### 🎨 Toujours utiliser le design system — JAMAIS de hex hardcodés ni de Tailwind brut

**Règle non négociable** pour TOUT développement UI (composant React, page,
template SVG, chart Recharts, email HTML). La source de vérité est triple :

- `src/design-system/tokens.ts` — couleurs JS pour Recharts/SVG (`tokens.brand.primary[600]`, `tokens.glycemia.normal`, etc.)
- `src/styles/tokens.css` — variables CSS `--diabeo-*` (couleurs, spacing, radius, typo, z-index, transitions)
- `src/app/globals.css` `@theme inline` — mapping vers les classes Tailwind sémantiques

**✅ TOUJOURS** :

```tsx
// Classes Tailwind sémantiques (shadcn + design system Diabeo)
<button className="bg-primary text-primary-foreground hover:bg-primary/90">Connexion</button>
<div className="bg-muted text-muted-foreground border-border">…</div>
<p className="text-glycemia-critical">Glycémie en hyper</p>
<Badge className="bg-feedback-warning">Stale</Badge>

// JS pour Recharts/SVG → import depuis le module tokens
import { tokens } from "@/design-system/tokens"
<Line stroke={tokens.brand.primary[600]} />
<Cell fill={tokens.glycemia.normal} />
```

**❌ JAMAIS** :

```tsx
// Tailwind brut par numéro (contournement du design system)
<button className="bg-teal-600 hover:bg-teal-700">…</button>  // ❌ → bg-primary
<div className="bg-red-500">Erreur</div>                       // ❌ → bg-destructive
<p className="text-gray-500">…</p>                             // ❌ → text-muted-foreground
<span className="border-blue-300">…</span>                     // ❌ pas dans la palette Diabeo

// CSS vars en `arbitrary-value` (interdit explicitement par docs/design-system/tokens.md)
<div className="bg-[var(--color-primary)]">…</div>             // ❌ → bg-primary
<p className="text-[var(--color-muted-foreground)]">…</p>       // ❌ → text-muted-foreground

// Hex hardcodés en JSX/SVG/style inline
<svg fill="#0D9488" />                                          // ❌ → fill={tokens.brand.primary[600]}
<div style={{ color: "#F97316" }}>…</div>                       // ❌ → text-secondary
<Line stroke="#10B981" />                                       // ❌ → stroke={tokens.glycemia.normal}

// Valeurs arbitraires (sauf justification documentée)
<div className="mt-[17px] text-[13.5px]">…</div>               // ❌ → mt-4 + text-sm
```

**Logos / branding** : utiliser le composant `<Logo />` ou `<LogoMark />` de
`src/components/diabeo/brand/Logo.tsx` (variants `full`/`mark`/`mono`/`inverse`).
**JAMAIS** un `<div bg-teal-600><span>D</span></div>` improvisé.

**Exceptions tolérées** (uniquement quand documentées par un commentaire) :
- Hex sans équivalent token précis dans un mapping de couleurs métier (ex:
  `appointments/adapter.ts` pour des shades amber-100/900). Toujours commenter
  « pas d'équivalent token » à côté.
- `text-white` natif Tailwind sur un fond coloré (alternatif : `text-primary-foreground`).
- Templates **email HTML** (`src/lib/services/email.service.ts`) : inline CSS
  acceptable car contexte non-React, mais préférer extraire les couleurs vers
  une constante locale qui reflète `tokens.ts`.

**Tokens disponibles** (extrait — voir `docs/design-system/` pour la liste exhaustive) :
- Couleurs : `bg-primary`, `bg-secondary`, `bg-muted`, `bg-card`, `bg-background`, `bg-foreground`, `bg-destructive`, `bg-border`, `bg-teal-{50..950}`, `bg-coral-{50..950}`, `bg-glycemia-{very-low,low,normal,high,very-high,critical}{,-bg,-border}`, `bg-feedback-{success,warning,error,info}{,-bg}`, `bg-tir-{very-low,low,in-range,high,very-high}`, `bg-pathology-{dt1,dt2,gd}{,-bg}`
- Opacité : `bg-primary/10`, `text-destructive/80` (syntaxe Tailwind 4 native)
- Spacing : `p-{0..24}`, `gap-{0..24}` (échelle 4px Diabeo)
- Radius : `rounded-{sm,md,lg,xl,2xl,full}`
- Z-index : `z-{base,dropdown,sticky,header,overlay,modal,popover,toast,critical-alert}`
- Transitions : `duration-{fast,normal,slow,slower}`, `ease-{default,in,out,in-out,spring}`
- Shadows : `shadow-diabeo-{xs,sm,md,lg,xl,critical,warning,success,primary}`

**Avant de hardcoder** : grep le token (ex: `grep "primary-600" src/styles/tokens.css`)
ou demander la classe sémantique équivalente. Si vraiment aucun token ne convient
→ proposer son ajout dans `tokens.ts` + `tokens.css` + `globals.css` AVANT de
hardcoder, jamais l'inverse.

### 🔤 Acronymes dans l'affichage client — JAMAIS d'acronyme nu

Tout acronyme **visible par l'utilisateur** (médical, réglementaire, métier) doit être
explicité. Deux formats, selon le contexte de rendu :

1. **Acronyme + infobulle** (préféré) quand l'acronyme est rendu par un composant :
   utiliser `<Acronym code="TIR" />` (`components/diabeo/Acronym.tsx`) — affiche
   l'acronyme et le libellé complet en `Tooltip`. Le libellé vit dans le namespace
   i18n `glossary` (FR/EN/AR), source unique.
2. **« Libellé (ACRONYME) »** inline quand l'acronyme est dans une chaîne de texte
   (phrase, alerte, description) où une infobulle n'est pas posable. Ex :
   « Temps dans la cible (TIR) », « Hôpital de jour (HDJ) ».

**Exceptions** :
- `RDV` → toujours **« Rendez-vous »** (libellé seul, pas d'acronyme).
- `MAJ` → toujours **« Mise à jour »** (libellé seul).
- Acronymes **techniques universels** (`PDF`, `CSV`, `PNG/JPG`, `API`, `USB`, `JSON`),
  **noms de produits** (`G7`…) et **notation statistique de percentiles**
  (`P10`/`P25`/`P50`/`P75`/`P90` des graphes AGP) : laissés tels quels.

Règle valable sur **les 3 langues** (`messages/fr|en|ar.json`). Tout nouvel acronyme
affiché → ajouter son libellé dans `glossary` avant de l'utiliser.

### 🌐 Texte affiché via i18n — mais JAMAIS les logs

Tout **texte visible par l'utilisateur** doit passer par `next-intl` (`{t("clé")}` /
`getTranslations`), pas en dur dans le JSX. Garde-fou : règle ESLint
`i18next/no-literal-string` (`warn`, `mode: jsx-text-only`, hors `components/ui`).

**Exclusion stricte — on n'internationalise JAMAIS un log.** Les messages de
`console.*`, `logger.*`, les erreurs techniques/dev, les messages d'exception
internes et les identifiants/clés restent des **chaînes littérales** (ils servent
au debug/SOC, pas à l'utilisateur ; les traduire casserait le grep des logs et la
corrélation incident). La règle `jsx-text-only` ne les flague pas — ne pas les
ajouter aux fichiers `messages/*.json`.

---

## 🔐 Règles de sécurité — NON NÉGOCIABLES

### Chiffrement des données de santé (AES-256-GCM)

```typescript
// ✅ TOUJOURS chiffrer avant insertion en base
import { encrypt, decrypt } from "@/lib/crypto/health-data"

// Chiffrement — retourne Uint8Array avec format : IV (12 bytes) + TAG (16 bytes) + CIPHERTEXT
const plaintext = "Dupont"
const encrypted = encrypt(plaintext)  // Uint8Array

// Conversion en base64 pour stockage en String columns (ex: User.firstname)
const encryptField = (value: string): string =>
  Buffer.from(encrypt(value)).toString("base64")

// Déchiffrement — accepte base64 et reconvertit en Uint8Array
const decryptField = (value: string): string =>
  decrypt(new Uint8Array(Buffer.from(value, "base64")))

// JAMAIS logger plaintext après encrypt — vérifier le format Uint8Array

// ❌ JAMAIS : Buffer.from(encrypt(value)).toString("utf8") — corrompt les données
// ✅ TOUJOURS : Buffer.from(encrypt(value)).toString("base64") — safe pour String columns
```

### Audit & Traçabilité HDS

```typescript
// ✅ TOUJOURS auditer chaque accès (READ, CREATE, UPDATE) à une donnée de santé
await auditService.log({
  userId,
  action: "READ",
  resource: "PATIENT",
  resourceId: String(patientId),
  ipAddress,  // Extraction auto via extractRequestContext(req)
  userAgent,
  metadata: { ... }
})

// ❌ JAMAIS logger les valeurs décryptées dans audit_logs
// ❌ JAMAIS stocker plaintext de santé en clair
// ❌ JAMAIS exposer le Buffer/base64 chiffré dans les API responses
```

### Soft delete patients (RGPD)

```typescript
// Soft delete UNIQUEMENT — jamais de DELETE physique sur les patients
// PostgreSQL trigger (audit_immutability.sql) anonymise les données chiffrées
// Voir patient.service.ts → deletePatient()

// Pattern : UPDATE patient SET deletedAt = NOW() WHERE id = ?
// Le patient reste queryable avec WHERE deletedAt IS NULL
```

### Validation médicale (Insulin Therapy)

```typescript
// InsulinTherapySettings et configurations associées (GlucoseTarget, ISF, ICR, BasalConfiguration)
// Bornes cliniques appliquées — voir insulin.service.ts CLINICAL_BOUNDS

// Avant ajout à production : validatedBy = DOCTOR.id
// Bolus suggestions : JAMAIS injectées sans acceptation explicite du patient
// Pattern : BolusCalculationLog → AdjustmentProposal (status=pending) → review DOCTOR → accept/reject
```

### API Routes (JWT RS256 + RBAC)

```typescript
// ✅ Toute route doit vérifier auth + rôle via helpers
import { requireAuth, requireRole, AuthError } from "@/lib/auth"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  try {
    // Le middleware JWT injecte x-user-id et x-user-role dans les headers
    const user = requireRole(req, "ADMIN") // throws AuthError si non autorisé

    // user.id et user.role sont disponibles
    // ...
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

// Helpers disponibles :
// getAuthUser(req)    → AuthUser | null  (lecture sans throw)
// requireAuth(req)    → AuthUser         (throw 401)
// requireRole(req, R) → AuthUser         (throw 401 ou 403)
```

### Validation des inputs avec Zod

```typescript
// TOUJOURS valider avant d'appeler un service
import { z } from "zod"
import { NextResponse } from "next/server"

const schema = z.object({
  patientId: z.number().int().positive(),
  glucoseValue: z.number().min(40).max(600),
  timestamp: z.coerce.date(),
})

export async function POST(req: Request) {
  const body = await req.json()
  const result = schema.safeParse(body)

  if (!result.success) {
    return NextResponse.json(
      { error: "Validation failed", details: result.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  // result.data est typé et sûr
}
```

### HMAC pour lookup unique (emailHmac)

```typescript
// ❌ JAMAIS : SELECT * FROM users WHERE email = ?  (email chiffré = lookup impossible)
// ✅ TOUJOURS : SELECT * FROM users WHERE emailHmac = HMAC-SHA256(email, secret)

import { createHmac } from "crypto"

function hmacEmail(email: string): string {
  const key = process.env.HMAC_SECRET  // 32+ bytes, stable en production
  return createHmac("sha256", key).update(email).digest("hex")
}

// Index UNIQUE sur emailHmac permet lookups rapides sans sacrifier la confidentialité
```

---

## 👥 Rôles utilisateurs (RBAC)

| Rôle    | Permissions |
|---------|-------------|
| ADMIN   | Tout — gestion users, audit, config système |
| DOCTOR  | Patients de son portefeuille, validation InsulinConfig |
| NURSE   | Consultation patients, création InsulinConfig (sans validation) |
| VIEWER  | Lecture seule sur son périmètre autorisé |

---

## 🗄️ Architecture des données

**Source de vérité** : `prisma/schema.prisma` (48 tables × 11 domaines, 21 enums).

Carte mentale des 11 domaines :

1. **Utilisateur & Auth** (7 tables) — `User` avec `emailHmac` (HMAC-SHA256) pour lookup sans exposer email chiffré, `Account/Session/VerificationToken`, préférences (Unit/Notif/Privacy).
2. **Patient & Données médicales** (8 tables) — `Patient` (pathology DT1/DT2/GD, soft delete RGPD), `PatientMedicalData` (antécédents chiffrés), `Treatment`, objectifs glycémiques.
3. **Configuration insulinothérapie** (8 tables) — `InsulinTherapySettings` (root), `ISF`/`ICR` par slot horaire (Time, pas Timestamp), `BasalConfiguration` + `PumpBasalSlot`.
4. **Glycémie & CGM** (5 tables) — `CgmEntry` (partitionnée par mois), `GlycemiaEntry`, `BolusCalculationLog` (immutable).
5. **Événements & Activités** (3 tables) — `DiabetesEvent` (`eventType` ARRAY d'énums), `InsulinFlowEntry`, `PumpEvent`.
6. **Propositions d'ajustement** (1 table) — `AdjustmentProposal` (status pending/accepted/rejected, jamais auto-appliqué).
7. **Appareils & Sync** (4 tables) — `PatientDevice` (revoked tracking), `DeviceDataSync`.
8. **Équipe médicale** (4 tables) — `HealthcareService`, `HealthcareMember`, `PatientService`, `PatientReferent`.
9. **Documents & RDV** (3 tables) — `MedicalDocument` (S3, ClamAV), `Appointment`, `Announcement`.
10. **Notifications Push** (4 tables) — FCM tokens, templates, logs, scheduled.
11. **Configuration & UI** (3 tables) — unités, moments du jour, dashboard layouts.

**AuditLog** (table spéciale) — immutable via trigger PG (`audit_immutability.sql`). JAMAIS de PHI en clair.
Convention `resourceId` (US-2268) : ID natif + `metadata.patientId` pivot pour forensics CNIL/ANS. GIN partial sur `metadata->'patientId'`.

Pour les détails de champs, contraintes, indexes : lire `prisma/schema.prisma` directement, ou interroger le knowledge graph (`/graphify query "..."`).
## 💊 Logique métier Diabeo

### Calcul de bolus (insulin.service.ts)

```typescript
/**
 * Bolus = suggestion JAMAIS automatique
 * Format : BolusCalculationLog (immuable) → AdjustmentProposal (status=pending)
 * Patient accepte explicitement avant injection
 */

// CLINICAL_BOUNDS (bornes de sécurité) :
// ⚠️ SOURCE DE VÉRITÉ UNIQUE = src/lib/clinical-bounds.ts. Ce bloc est une copie
// pédagogique, gardée synchrone par tests/unit/clinical-bounds.test.ts.
const CLINICAL_BOUNDS = {
  ISF_GL_MIN: 0.10,    ISF_GL_MAX: 1.00,    // g/L/U (élargi pour DT2 insulino-résistant)
  ISF_MGDL_MIN: 10,    ISF_MGDL_MAX: 100,  // mg/dL/U (règle 1800)
  ICR_MIN: 3.0,        ICR_MAX: 30.0,       // g/U (élargi pédiatrie + résistant)
  BASAL_MIN: 0.05,     BASAL_MAX: 5.0,     // U/h
  TARGET_MIN_MGDL: 60, TARGET_MAX_MGDL: 250,
  MAX_SINGLE_BOLUS: 25.0,        // U — jamais dépasser
  INSULIN_ACTION_MIN: 3.5,       // heures (durée d'action analogues rapides)
  INSULIN_ACTION_MAX: 5.0,       // heures
  PUMP_BASAL_INCREMENT: 0.05,    // U/h
}

// Formule : findSlotForHour(settings.sensitivityFactors, hour)
// Sélection : premier slot dont l'intervalle [startHour, endHour) contient `hour`
// (intervalle demi-ouvert ; passage minuit géré si startHour > endHour)
// Aucune correspondance → renvoie undefined → l'appelant LÈVE ("No ISF/ICR slot
// found for current hour"). Fail-closed : pas de fallback, jamais de dose calculée
// sur une heure non couverte par la config.

// Calcul final :
// Bolus repas     = carbsGrams / icr.gramsPerUnit
// Correction      = max(0, (currentMgdl - targetMgdl) / isf.sensitivityFactorMgdl)
// IOB ajustment   = appliquer insulinActionDuration + insulinActionPeakTime
// Total recommandé = mealBolus + correctionDose - iobAdjustment
// Cappage = min(recommendedDose, CLINICAL_BOUNDS.MAX_SINGLE_BOLUS)
```

### Transaction Prisma 7 (insulin.service.ts)

```typescript
// Prisma 7 supprime $use() middleware — audit immutabilité via DB trigger
// Bolus calculation + log tout dans une transaction

async calculateBolus(input: BolusInput, auditUserId: number): Promise<BolusResult> {
  return prisma.$transaction(async (tx) => {
    const log = await tx.bolusCalculationLog.create({ data: { ... } })
    await auditService.logWithTx(tx, { action: "BOLUS_CALCULATED", ... })
    return { ...log, warnings: [...] }
  })
}
```

### Sélection du ratio horaire (time-of-day slots)

```typescript
// InsulinSensitivityFactor, CarbRatio, PumpBasalSlot utilisent Time (pas Timestamp)
// Time = "HH:MM:SS" pour heure du jour — stockage léger, pas timezone

// ⚠️ Source de vérité = insulin.service.ts (findSlotForHour). Sélection par
// intervalle demi-ouvert [startHour, endHour), avec gestion du passage minuit.
// AUCUN fallback : une heure non couverte renvoie undefined et l'appelant lève
// ("No ISF/ICR slot found for current hour") → calcul de bolus fail-closed.
const findSlotForHour = <T extends { startHour: number; endHour: number }>(
  slots: T[],
  hour: number,
): T | undefined =>
  slots.find((s) =>
    s.startHour <= s.endHour
      ? hour >= s.startHour && hour < s.endHour       // intervalle normal
      : hour >= s.startHour || hour < s.endHour,       // passage minuit (22h → 6h)
  )
```

### Services avec transactions Prisma 7

```typescript
// patient.service.ts  : create, getById, listByDoctor, deletePatient
// insulin.service.ts  : getSettings, calculateBolus
// audit.service.ts    : log, logWithTx, query
// user.service.ts     : getProfile, updateProfile, acceptTerms, acceptDataPolicy, dayMoments
// export.service.ts   : generateUserExport (RGPD Art. 20)
// deletion.service.ts : deleteUserAccount (RGPD Art. 17, cascade 48 tables)

// Chaque service découplé de Next.js — réutilisable dans API routes ou edge functions
// Types Prisma importés depuis @prisma/client
```

---

## 🛠️ Commandes utiles

```bash
# Développement local
pnpm dev                               # Next.js sur localhost:3000
docker compose --profile local up      # PostgreSQL 16 local uniquement

# Prisma 7+ (générateur client, extensions PostgreSQL)
# US-2267 — Migrations versionnées : `db push` interdit en prod, voir docs/runbook/migrations.md
pnpm prisma migrate dev --name name    # Créer migration locale + apply (commit le dossier généré)
pnpm prisma migrate deploy             # Appliquer migrations en prod (idempotent, sans shadow DB)
pnpm prisma migrate status             # État des migrations (pending / applied)
pnpm prisma migrate resolve --applied <ts>_<name>  # Marquer applied sans rejouer (DB existante)
pnpm prisma studio                     # Interface graphique BDD (localhost:5555)
pnpm prisma db seed                    # Injecter données de test (5 users, 2 patients, 30j CGM)
pnpm prisma generate                   # Régénérer client @prisma/client (auto avec migrate)

# Vérification cohérence schema ↔ migrations (CI gate, US-2267)
# SHADOW_DATABASE_URL requis — DB séparée que Prisma utilise pour appliquer les migrations
# en isolation. Exit 0 = no drift, Exit 2 = drift détecté → CI échoue.
pnpm prisma migrate diff --from-migrations prisma/migrations \
  --to-schema prisma/schema.prisma --exit-code

# Chiffrement & Auth — configuration requise
export HEALTH_DATA_ENCRYPTION_KEY="..."  # 32 bytes en hex (64 caractères)
export HMAC_SECRET="..."                 # 32+ bytes pour emailHmac
export JWT_PRIVATE_KEY="..."             # RSA privée PEM (RS256)
export JWT_PUBLIC_KEY="..."              # RSA publique PEM (RS256)

# Tests
pnpm test                              # Jest sur src/lib/services
pnpm test:e2e                          # Playwright sur pages et API routes

# Audit SQL (référence — à appliquer manuellement après migration)
# psql $DATABASE_URL < prisma/sql/audit_immutability.sql
# psql $DATABASE_URL < prisma/sql/cgm_partitioning.sql
# psql $DATABASE_URL < prisma/sql/basal_config_check.sql
# psql $DATABASE_URL < prisma/sql/patient_insulin_constraints.sql

# Déploiement OVHcloud
./deploy.sh update                     # Pull + migrate + restart services
./deploy.sh status                     # Statut PostgreSQL, Redis, API
./deploy.sh backup                     # Backup manuel PostgreSQL
```

---

## 🗺️ Knowledge graph (graphify)

Ce repo a un knowledge graph pré-construit dans `graphify-out/` (8 231 nœuds,
17 074 edges, 411 communautés — couvre 2 271 fichiers : code + docs + UserStory + ADRs + i18n).

**Pour Claude Code** : pour toute question d'exploration ("comment marche X ?",
"qui appelle Y ?", "trace le flow Z", "où est défini A ?"), utilise
`/graphify query "..."` AVANT grep/Read. Le graphe répond en ~2-8k tokens
contre 30-150k pour grep+Read sur les questions équivalentes.

**Commandes utiles** :
- `/graphify query "<question>"` — réponse focalisée (BFS sur le graphe)
- `/graphify path "<A>" "<B>"` — chemin le plus court entre 2 concepts
- `/graphify explain "<node>"` — explication contextualisée d'un symbole
- `/graphify --update` — re-build incrémental (cache hit sur fichiers inchangés)
- Voir `graphify-out/GRAPH_REPORT.md` pour god nodes, communautés, surprising connections

**Setup sur nouvelle machine** :
```bash
python3.12 -m venv graphify-out/.venv
graphify-out/.venv/bin/pip install graphifyy
echo "$(graphify-out/.venv/bin/python -c 'import sys; print(sys.executable)')" > graphify-out/.graphify_python
echo "$(pwd)" > graphify-out/.graphify_root
graphify hook install   # post-commit auto-rebuild (AST only, 0 token, 3-10s)
```

Le hook git rebuild automatiquement le graphe après chaque commit (code uniquement,
sans LLM). Pour les changements de docs/UserStory, lance `/graphify --update` manuellement.

Le `.venv/` et les fichiers `.graphify_python`/`.graphify_root` sont machine-specific
(exclus du repo via `.gitignore`). Le reste (`graph.json`, `chunk_*.json`, `cache/`,
`manifest.json`, `.graphify_labels.json`) est versionné — la re-extraction est gratuite
au prochain `--update` tant que les fichiers source n'ont pas bougé.

---

## 🚫 Ce que Claude Code ne doit JAMAIS faire

- Modifier les fichiers dans `components/ui/` (shadcn/ui auto-généré)
- Créer des DELETE physiques sur la table `patients`
- Stocker quoi que ce soit dans `localStorage` ou les cookies non-httpOnly
- Uploader des fichiers sur le disque du VPS (toujours OVH Object Storage)
- Commiter des secrets, clés ou mots de passe
- Créer des migrations destructives (DROP COLUMN, DROP TABLE) sans confirmation explicite
- Désactiver les middlewares d'authentification pour "tester plus vite"
- Exposer des stack traces ou messages d'erreur internes dans les API responses
- **Merger une pull request sans AUTORISATION EXPLICITE de l'utilisateur sur CETTE PR précise.**
  - Une autorisation de lancer un batch ("a", "b", "go", "on commence Batch X") ≠ autorisation de merge.
  - "ci ok", "tests verts", "la review est OK" ≠ autorisation de merge.
  - Même si la CI est verte, même si les reviews sont appliquées, même après plusieurs PRs précédentes mergées sur autorisation : il faut demander "je peux merger ?" et obtenir un GO explicite ("oui merge", "tu peux merger", "merge-la") avant tout `gh pr merge`.
  - L'autorisation de merge d'une PR ne se reporte JAMAIS sur la PR suivante.
- Merger une pull request si la CI (pipeline) a des erreurs
- **Pousser DIRECTEMENT sur `main` (`git push origin main`).**
  - Inclut TOUT commit, même docs-only (CLAUDE.md, ROADMAP.md, README, comments).
  - Inclut les "petites mises à jour de footer", les "updates de stats", les "fix de typo".
  - Tout changement passe par : branche dédiée → PR → CI verte → autorisation de merge explicite → `gh pr merge`.
  - Le contournement "c'est juste de la doc, la CI ne s'applique pas" est interdit : la CI valide aussi la doc (markdown lint, lien rot), et le PR audit trail est nécessaire pour la traçabilité HDS/ANS.
- supprimer une feature sans le consentement explicite de l'utilisateur
- on ne developpe pas les applications android et ios
- **Hardcoder des couleurs ou des classes Tailwind brutes** dans un composant UI
  - Interdit : `bg-teal-600`, `text-red-500`, `border-gray-200`, `"#0D9488"`,
    `style={{ color: "#F97316" }}`, `bg-[var(--color-primary)]`
  - Toujours : classes sémantiques du design system (`bg-primary`,
    `text-destructive`, `text-muted-foreground`, `border-border`) ou
    `tokens.X` depuis `@/design-system/tokens` pour les SVG/Recharts.
  - Cf. section « 🎨 Toujours utiliser le design system » ci-dessus.
- Improviser un logo en JSX (`<div bg-teal-600><span>D</span></div>`) au lieu
  d'utiliser le composant `<Logo />` / `<LogoMark />` (`components/diabeo/brand/Logo.tsx`)
- **Supprimer le dossier `graphify-out/`** (knowledge graph local, gitignoré).
  - Il est coûteux à régénérer (~plusieurs M tokens d'extraction sémantique) et sert de carte du code pour les requêtes `/graphify`.
  - Ne jamais le `rm -rf` même pour "faire de la place" ou "nettoyer" : seuls les fichiers temporaires `graphify-out/.graphify_*` (intermédiaires de pipeline) peuvent être nettoyés ; `graph.json`, `graph.html`, `GRAPH_REPORT.md` et `cache/` doivent être préservés.

---

## ✅ Checklist avant chaque PR

- [ ] Authentification + autorisation par rôle sur toutes les nouvelles API Routes
- [ ] Données patients chiffrées avant insertion, déchiffrées uniquement à la lecture
- [ ] `auditService.log()` appelé pour chaque accès à une donnée de santé
- [ ] Validation Zod sur tous les inputs des API Routes
- [ ] Pas de `console.log` avec des données patients
- [ ] Tests unitaires pour la logique métier ajoutée (couverture ≥ 80%)
- [ ] Types TypeScript stricts (pas de `any`)
- [ ] Composants accessibles (ARIA labels)
- [ ] **Design system respecté** : aucun hex hardcodé, aucun Tailwind brut par numéro (`bg-teal-600`, `text-red-500`), aucun `bg-[var(--color-X)]` — uniquement les classes sémantiques (`bg-primary`, `text-destructive`, `text-muted-foreground`…) ou `tokens.X` pour les SVG/Recharts

---

## 📋 Décisions architecturales (ADR)

| # | Décision | Raison |
|---|----------|--------|
| 1 | Monolithe Next.js (pas microservices) | POC 50k patients — complexité inutile |
| 2 | Chiffrement applicatif AES-256-GCM | Données sensibles protégées même si la BDD est compromise |
| 3 | JWT RS256 + Sessions en PostgreSQL | Auth stateless avec invalidation server-side |
| 4 | Soft delete patients | Conformité RGPD + auditabilité |
| 5 | OVH Object Storage dès le POC | Évite de bloquer le scaling futur |
| 6 | Upstash Redis pour le cache | Serverless = zéro config pour le POC |
| 7 | Docker Compose → K8s plus tard | Simplicité opérationnelle du POC |
| 8 | pgcrypto + AES-256-GCM Node natif | Chiffrement at-rest + applicatif en double couche |
| 9 | emailHmac (HMAC-SHA256) pour lookups | Permet index UNIQUE sans exposer email chiffré |
| 10 | Prisma 7 sans middleware $use() | Trigger PostgreSQL pour audit immutabilité (plus robuste) |
| 11 | Time (pas Timestamptz) pour slots | Ratios horaires = heure du jour indépendante de timezone |
| 12 | DiabetesEventType comme Array d'énums | Événement multi-catégorie (ex: "insulinMeal + physicalActivity") |
| 13 | BolusCalculationLog + AdjustmentProposal | Suggestion explicite jamais exécutée sans acceptation patient |
| 14 | 48 tables × 11 domaines | Modèle riche HDS : utilisateurs, patients, insuline, appareils, équipe, audit |
| 15 | Transaction Prisma pour bolus | Calcul + log atomique — consistance garantie |
| 16 | JWT RS256 custom (pas NextAuth) | Compatibilité API iOS existante, contrôle total payload/session |
| 17 | Migrations Prisma versionnées (US-2267) | Audit HDS exigeable, rollback formel, CI drift gate. `db push` interdit en prod. Voir `docs/runbook/migrations.md`. |
| 18 | `auditLog.resourceId` plat + `metadata.patientId` pivot (US-2268) | Forensics CNIL/ANS impossible avec composite. GIN index partiel garantit < 100ms à 10M logs. Helper `getByPatient` retrouve tous les events patient-scoped. |
| 19 | Prisma 7 driver adapter `@prisma/adapter-pg` | Prisma 7 a supprimé l'engine "library" — `new PrismaClient()` exige désormais un driver adapter ou `accelerateUrl`. `node-postgres` (pg) élimine le binaire Rust, améliore cold-start serverless. Voir `src/lib/db/client.ts` et `prisma/seed.ts`. |
| 20 | Early-fail env validation au boot (`src/lib/env.ts` + `instrumentation.ts`) | Sans ça, un secret manquant produit un 503 mystérieux au login. `assertRequiredEnv()` (serveur) + `assertSeedEnv()` (seed) crashent avec un message clair pointant vers `docs/local-development.md` §3. |
| 21 | Fiche patient unifiée `<PatientRecord>` — 1 composant présentational, 2 transports (page `?patientId` / drawer `cTok`) (epic US-2630) | Supprime la divergence page bespoke ⇄ onglets drawer bespoke. Le composant ne construit jamais d'URL porteuse d'id (anti-énumération) : `fetchAnalytics` injecté par le contexte. Modes CGM/BGM **fail-closed** (gating sur `dataSource`, pas sur l'absence de données). Voir `docs/architecture/fiche-patient-unifiee.md`. |

---

## 📊 Roadmap & backlog

- **Roadmap User Stories** : `docs/ROADMAP.md` (268 US, ~25% delivered, MVP en cours).
- **Décisions architecturales** : voir tableau ADR ci-dessus + détails dans `docs/architecture/`.
- **Conformité HDS/RGPD** : `docs/compliance/dpia-*.md` (1 DPIA par feature sensible).
- **Runbooks ops** : `docs/runbook/*.md` (migrations, cron, MFA, messaging, pepper rotation).
*Dernière révision : 2026-06-07 — nettoyage du CLAUDE.md pour réduire les tokens chargés à chaque session. Historique des PRs : `git log`.*