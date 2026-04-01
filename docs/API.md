# API Routes — Diabeo Backoffice

Documentation des routes API implémentées et planifiées pour le backoffice.

---

## Vue d'ensemble

| Endpoint | Méthode | Implémenté | Phase | Auth | Rôle |
|----------|---------|-----------|-------|------|------|
| `/api/auth/[...nextauth]` | GET/POST | ✅ | 0 | — | — |
| `/api/admin/audit-logs` | GET | ✅ | 0 | ✅ | ADMIN |
| `/api/patients` | GET, POST | ❌ | 1 | ✅ | DOCTOR, NURSE |
| `/api/patients/:id` | GET, PUT, DELETE | ❌ | 1 | ✅ | DOCTOR, NURSE |
| `/api/patients/:id/insulin/bolus` | POST | ❌ | 2 | ✅ | DOCTOR, NURSE |
| `/api/patients/:id/insulin/settings` | GET, PUT | ❌ | 2 | ✅ | DOCTOR, NURSE |
| `/api/patients/:id/cgm` | GET | ❌ | 2 | ✅ | DOCTOR, NURSE, VIEWER |
| `/api/patients/:id/insulin/validate` | POST | ❌ | 3 | ✅ | DOCTOR |

---

## Phase 0 : Implémenté

### 1. NextAuth v5 Endpoints

**Endpoint** : `/api/auth/[...nextauth]`

**Fichier** : `src/app/api/auth/[...nextauth]/route.ts` (à créer Phase 1)

**Configuration** : `src/lib/auth.ts`

```typescript
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [],  // TODO(Phase 1): Credentials, OAuth
  session: {
    strategy: "jwt",  // TODO(Phase 1): Passer à "database"
  },
  callbacks: {
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      if (token.role) session.user.role = token.role
      return session
    },
    jwt({ token, user }) {
      if (user) token.role = user.role
      return token
    },
  },
})
```

**Routes NextAuth auto-générées** :
- `GET /api/auth/signin` — Login page
- `POST /api/auth/callback/credentials` — Auth provider
- `POST /api/auth/signout` — Logout
- `GET /api/auth/session` — Session check
- `GET /api/auth/csrf` — CSRF token
- `POST /api/auth/callback/oauth` — OAuth providers (Phase 1)

**Modèle de session** :
```typescript
{
  user: {
    id: string          // Number as string
    role: Role          // ADMIN, DOCTOR, NURSE, VIEWER
    email?: string
    name?: string
    image?: string
  },
  expires: ISO8601     // Expiration JWT
}
```

**État Phase 0** :
- ✅ NextAuth v5 configuration
- ✅ Module augmentation (next-auth.d.ts)
- ❌ Providers credentials/OAuth
- ❌ Session DB strategy
- ❌ MFA support

---

### 2. Audit Logs Query — Admin Only

**Endpoint** : `GET /api/admin/audit-logs`

**Fichier** : `src/app/api/admin/audit-logs/route.ts`

**Authentification** : ✅ NextAuth + Admin RBAC

**Zod Schema** :
```typescript
const querySchema = z.object({
  userId: z.coerce.number().int().positive().optional(),
  resource: z.enum([
    "USER", "PATIENT", "CGM_ENTRY", "GLYCEMIA_ENTRY",
    "DIABETES_EVENT", "INSULIN_THERAPY", "BOLUS_LOG",
    "ADJUSTMENT_PROPOSAL", "MEDICAL_DOCUMENT", "SESSION",
  ]).optional(),
  action: z.enum([
    "LOGIN", "LOGOUT", "READ", "CREATE", "UPDATE", "DELETE",
    "EXPORT", "UNAUTHORIZED", "BOLUS_CALCULATED",
    "PROPOSAL_ACCEPTED", "PROPOSAL_REJECTED",
  ]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
```

**Exemple de requête** :
```bash
GET /api/admin/audit-logs?userId=1&resource=PATIENT&from=2026-03-01&to=2026-03-31&page=1&limit=50
```

**Response (200 OK)** :
```json
{
  "data": [
    {
      "id": 1,
      "userId": 1,
      "action": "READ",
      "resource": "PATIENT",
      "resourceId": "42",
      "oldValue": null,
      "newValue": null,
      "ipAddress": "192.168.1.1",
      "userAgent": "Mozilla/5.0...",
      "metadata": {
        "action": "list",
        "count": 5
      },
      "createdAt": "2026-03-31T14:23:00Z",
      "user": {
        "id": 1,
        "emailHmac": "abc123...",
        "firstname": null,  // Chiffré
        "lastname": null,   // Chiffré
        "role": "DOCTOR"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 156,
    "totalPages": 4
  }
}
```

**Erreurs** :
- `401 Unauthorized` — Pas d'authentification
- `403 Forbidden` — Pas admin (aussi loggé dans audit_logs)
- `400 Bad Request` — Paramètres invalides (Zod error)
- `500 Internal Server Error` — Erreur serveur (pas de stack trace)

**Implémentation** :
```typescript
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "ADMIN") {
    // Log forbidden access attempt
    await auditService.log({
      userId: Number(session.user.id),
      action: "UNAUTHORIZED",
      resource: "SESSION",
      resourceId: "audit-logs",
    })
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  // Validate query parameters
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  // Log audit query access
  await auditService.log({
    userId: Number(session.user.id),
    action: "READ",
    resource: "SESSION",
    resourceId: "audit-logs",
    metadata: { filters: parsed.data },
  })

  const result = await auditService.query(parsed.data)
  return NextResponse.json(result)
}
```

---

## Phase 1 : À implémenter

### 3. Patient List & CRUD

#### 3.1 GET /api/patients

**Description** : Lister les patients du docteur/nurse connecté.

**Authentification** : ✅ NextAuth + DOCTOR/NURSE

**Zod Schema** :
```typescript
const querySchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  take: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),  // Recherche sur nom/prénom déchiffrés
  pathology: z.enum(["DT1", "DT2", "GD"]).optional(),
  orderBy: z.enum(["createdAt", "lastname"]).default("createdAt"),
})
```

**Response (200 OK)** :
```json
{
  "data": [
    {
      "id": 1,
      "userId": 4,
      "pathology": "DT1",
      "deletedAt": null,
      "user": {
        "firstname": "Jean",
        "lastname": "Durand",
        "email": "jean@example.com",
        "sex": "M",
        "birthday": "1990-03-15",
        "timezone": "Europe/Paris"
      },
      "medicalData": {
        "dt1": true,
        "size": 178,
        "yearDiag": 2010
      },
      "insulinTherapySettings": { ... }
    }
  ],
  "pagination": {
    "skip": 0,
    "take": 10,
    "total": 42
  }
}
```

**Implémentation** :
```typescript
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!["DOCTOR", "NURSE"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query parameters", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const patients = await patientService.listByDoctor(Number(session.user.id), Number(session.user.id))

  await auditService.log({
    userId: Number(session.user.id),
    action: "READ",
    resource: "PATIENT",
    resourceId: "list",
    metadata: { count: patients.length }
  })

  return NextResponse.json({ data: patients, pagination: {...} })
}
```

#### 3.2 POST /api/patients

**Description** : Créer un nouveau patient.

**Authentification** : ✅ NextAuth + DOCTOR/NURSE

**Zod Schema** :
```typescript
const createSchema = z.object({
  pathology: z.enum(["DT1", "DT2", "GD"]),
  email: z.string().email(),
  firstname: z.string().min(2),
  lastname: z.string().min(2),
  birthday: z.coerce.date().optional(),
  sex: z.enum(["M", "F", "X"]).optional(),
  phone: z.string().optional(),
  address1: z.string().optional(),
  cp: z.string().optional(),
  city: z.string().optional(),
})
```

**Request** :
```json
{
  "pathology": "DT1",
  "email": "patient@example.com",
  "firstname": "Sophie",
  "lastname": "Dupont",
  "birthday": "1985-06-12",
  "sex": "F",
  "phone": "+33612345678"
}
```

**Response (201 Created)** :
```json
{
  "id": 3,
  "userId": 10,
  "pathology": "DT1",
  "user": {
    "id": 10,
    "email": "patient@example.com",
    "firstname": "Sophie",
    "lastname": "Dupont"
  }
}
```

#### 3.3 GET /api/patients/:id

**Description** : Récupérer un patient spécifique.

**Paramètre** : `id` (INT) — Patient ID

**Response (200 OK)** :
```json
{
  "id": 1,
  "pathology": "DT1",
  "user": { ... },
  "medicalData": { ... },
  "insulinTherapySettings": {
    "id": 1,
    "bolusInsulinBrand": "novorapid",
    "deliveryMethod": "pump",
    "sensitivityFactors": [
      {
        "startHour": 6,
        "endHour": 12,
        "sensitivityFactorGl": 0.30,
        "sensitivityFactorMgdl": 30
      },
      ...
    ],
    "carbRatios": [ ... ],
    "basalConfiguration": {
      "pumpSlots": [
        { "startTime": "00:00:00", "endTime": "06:00:00", "rate": 0.65 },
        ...
      ]
    }
  }
}
```

#### 3.4 PUT /api/patients/:id

**Description** : Mettre à jour un patient.

**Zod Schema** :
```typescript
const updateSchema = z.object({
  firstname: z.string().optional(),
  lastname: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address1: z.string().optional(),
  cp: z.string().optional(),
  city: z.string().optional(),
  timezone: z.string().optional(),
})
```

#### 3.5 DELETE /api/patients/:id

**Description** : Soft delete d'un patient (RGPD).

**Response (200 OK)** :
```json
{
  "id": 1,
  "deletedAt": "2026-03-31T15:00:00Z"
}
```

---

### 4. Insulin Therapy

#### 4.1 POST /api/patients/:id/insulin/bolus

**Description** : Calculer une suggestion de bolus.

**Authentification** : ✅ NextAuth + DOCTOR/NURSE

**Zod Schema** :
```typescript
const bolusSchema = z.object({
  currentGlucoseGl: z.number().min(0.2).max(6.0),  // g/L
  carbsGrams: z.number().min(0).max(200),
})
```

**Request** :
```json
{
  "currentGlucoseGl": 1.4,
  "carbsGrams": 45
}
```

**Response (200 OK)** :
```json
{
  "mealBolus": 5.63,
  "correctionDose": 0.26,
  "recommendedDose": 5.9,
  "warnings": [],
  "deliveryMethod": "pump"
}
```

**Response (200 OK — avec warnings)** :
```json
{
  "mealBolus": 12.0,
  "correctionDose": 3.5,
  "recommendedDose": 15.0,  // Capped à MAX_SINGLE_BOLUS
  "warnings": [
    "exceedsMaximumBolus",
    "severeHyperglycemia"
  ],
  "deliveryMethod": "pump"
}
```

**Implémentation** :
```typescript
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!["DOCTOR", "NURSE"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const body = await req.json()
  const parsed = bolusSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }

  const result = await insulinService.calculateBolus(
    {
      patientId: parseInt(params.id),
      ...parsed.data
    },
    Number(session.user.id)
  )

  return NextResponse.json(result)
}
```

#### 4.2 GET /api/patients/:id/insulin/settings

**Description** : Récupérer configuration insuline complète.

**Response** :
```json
{
  "id": 1,
  "patientId": 1,
  "bolusInsulinBrand": "novorapid",
  "basalInsulinBrand": null,
  "insulinActionDuration": 4.0,
  "deliveryMethod": "pump",
  "glucoseTargets": [
    {
      "targetGlucose": 120,
      "targetRangeLower": 0.70,
      "targetRangeUpper": 1.80,
      "preset": "standard",
      "isActive": true
    }
  ],
  "sensitivityFactors": [ ... ],
  "carbRatios": [ ... ],
  "basalConfiguration": { ... }
}
```

#### 4.3 PUT /api/patients/:id/insulin/settings

**Description** : Mettre à jour la configuration insuline.

**Authentification** : ✅ NextAuth + DOCTOR (validation médicale)

---

### 5. CGM Data & Analytics

#### 5.1 GET /api/patients/:id/cgm

**Description** : Récupérer données CGM (30 derniers jours).

**Zod Schema** :
```typescript
const cgmSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  resolution: z.enum(["raw", "15min", "hourly"]).default("raw"),
})
```

**Response** :
```json
{
  "patientId": 1,
  "from": "2026-03-01T00:00:00Z",
  "to": "2026-03-31T23:59:59Z",
  "data": [
    {
      "id": 1234,
      "timestamp": "2026-03-31T14:23:00Z",
      "valueGl": 1.35,
      "valueMgdl": 135,
      "isManual": false,
      "deviceId": "dexcom-001"
    },
    ...
  ],
  "statistics": {
    "averageGl": 1.45,
    "minGl": 0.65,
    "maxGl": 2.80,
    "stdDeviation": 0.34,
    "timeInRange": 0.72,
    "timeBelow70": 0.05,
    "timeAbove180": 0.12
  }
}
```

#### 5.2 GET /api/analytics/tir

**Description** : Time-In-Range analytics (Time In Range — % temps en cible).

---

## Phase 2+ : Planifiés

### 6. Documents & Fichiers

```
POST /api/documents                 — Upload MedicalDocument (OVH S3)
GET /api/documents/:id              — Télécharger document
DELETE /api/documents/:id           — Supprimer document
```

### 7. Healthcare Team Management

```
GET /api/healthcare-services        — Lister services
POST /api/healthcare-services       — Créer service
GET /api/healthcare-members         — Lister équipe
POST /api/patients/:id/referent     — Assigner médecin référent
```

### 8. Appointments

```
GET /api/appointments               — Lister RDV
POST /api/appointments              — Créer RDV
PUT /api/appointments/:id           — Modifier RDV
DELETE /api/appointments/:id        — Annuler RDV
```

### 9. Notifications

```
GET /api/notifications              — Lister notifications
POST /api/notifications/subscribe   — S'abonner push
DELETE /api/notifications/token     — Se désabonner
```

---

## Standards de réponse

### Success Response (200/201)

```json
{
  "data": { ... },
  "pagination": { ... }  // Si applicable
}
```

### Error Response (400/401/403/500)

```json
{
  "error": "User-friendly message",
  "details": {
    "field": ["Error message"]
  }  // Si Zod validation
}
```

**JAMAIS** de stack traces dans les réponses production.

---

## Headers requis

### Requêtes API

```
Content-Type: application/json
Authorization: Bearer <JWT token>  (NextAuth session)
User-Agent: Mozilla/5.0...        (Automatique)
X-Forwarded-For: 192.168.1.1      (Proxy)
```

### Réponses API

```
Content-Type: application/json; charset=utf-8
Cache-Control: no-store             (Données sensibles)
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000
```

---

## Pagination

Standard pour les listes :

```json
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 156,
    "totalPages": 4
  }
}
```

**Paramètres** :
- `page` (default: 1) — Numéro de page
- `limit` (default: 50, max: 200) — Items par page
- Côté serveur : `skip = (page - 1) * limit`

---

## Rate Limiting

À implémenter Phase 1 (Upstash Redis) :

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1609459200
```

---

## Roadmap API

### Phase 0 (✅ Implémenté)
- NextAuth v5 configuration
- `/api/admin/audit-logs` (GET)

### Phase 1 (À faire)
- `/api/patients` (GET, POST, PUT, DELETE)
- `/api/auth/signin`, `/api/auth/signout`
- Credentials provider + password reset

### Phase 2 (À faire)
- `/api/patients/:id/insulin/bolus` (POST)
- `/api/patients/:id/insulin/settings` (GET, PUT)
- `/api/patients/:id/cgm` (GET)
- `/api/analytics/tir` (GET)

### Phase 3 (À faire)
- `/api/patients/:id/insulin/validate` (POST — DOCTOR only)
- `/api/adjustment-proposals` (GET, POST)

### Phase 4 (À faire)
- Document management avec OVH S3
- Healthcare team management
- Appointments

---

Dernière mise à jour : 2026-03-31 (Phase 0)
