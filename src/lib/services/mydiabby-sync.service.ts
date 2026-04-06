/**
 * MyDiabby sync orchestrator — staging only.
 *
 * Manages the full lifecycle of MyDiabby synchronization:
 * - Connect: authenticate, store credentials, run initial import
 * - Sync: fetch latest data, map, deduplicate, insert
 * - Disconnect: remove stored credentials
 * - SyncAll: cron-triggered sync for all active credentials
 *
 * Security:
 * - APP_ENV guard: refuses to run in production
 * - Credentials (email, password) are encrypted AES-256-GCM
 * - MyDiabby tokens stored in DB, auto-refreshed before each sync
 * - All operations logged in AuditLog and MyDiabbySyncLog
 *
 * @see US-900 — Synchronisation des données depuis MyDiabby
 */

import { prisma } from "@/lib/db/client"
import { encryptField, safeDecryptField } from "@/lib/crypto/fields"
import { hmacEmail } from "@/lib/crypto/hmac"
import {
  authenticate,
  getAccount,
  getData,
  refreshMyDiabbyToken,
} from "./mydiabby-client.service"
import {
  mapUser,
  mapPatient,
  mapCgmEntries,
  mapGlycemiaEntries,
  mapInsulinFlowEntries,
  mapSnackEntries,
  mapMedicalData,
  mapUnitPreferences,
  mapCgmObjective,
  mapBasalSchedule,
  mapIcrSchedule,
  mapIsfSchedule,
} from "./mydiabby-mapper.service"
import { auditService } from "./audit.service"

const BATCH_SIZE = 1000

export interface SyncResult {
  credentialId: number
  status: "success" | "error" | "partial"
  cgmCount: number
  glycemiaCount: number
  eventCount: number
  profileUpdated: boolean
  errorMessage?: string
  durationMs: number
}

function assertStagingEnv(): void {
  if (process.env.APP_ENV === "production") {
    throw new Error("[mydiabby-sync] Sync is disabled in production")
  }
}

// ── Connect ────────────────────────────────────────────────

/**
 * Connect a Diabeo user to their MyDiabby account.
 * Authenticates, stores encrypted credentials, runs initial sync.
 */
export async function connectAccount(
  userId: number,
  email: string,
  password: string,
): Promise<SyncResult> {
  assertStagingEnv()

  // Authenticate with MyDiabby
  const authResult = await authenticate(email, password)

  if (authResult.data.need2fa) {
    throw new Error("MyDiabby account requires 2FA — not supported")
  }

  // Store encrypted credentials
  const credential = await prisma.myDiabbyCredential.upsert({
    where: { userId },
    create: {
      userId,
      mydiabbyUid: authResult.data.uid,
      email: encryptField(email),
      password: encryptField(password),
      token: authResult.token,
      refreshToken: authResult.refresh_token,
      tokenExpiresAt: new Date(Date.now() + 24 * 3600_000), // 24h
      isActive: true,
    },
    update: {
      mydiabbyUid: authResult.data.uid,
      email: encryptField(email),
      password: encryptField(password),
      token: authResult.token,
      refreshToken: authResult.refresh_token,
      tokenExpiresAt: new Date(Date.now() + 24 * 3600_000),
      isActive: true,
      consecutiveErrors: 0,
    },
  })

  await auditService.log({
    userId,
    action: "CREATE",
    resource: "MYDIABBY_CREDENTIAL",
    resourceId: String(credential.id),
  })

  // Run initial sync
  return syncCredential(credential.id)
}

// ── Sync single credential ────────────────────────────────

/**
 * Sync data for a single MyDiabby credential.
 * Refreshes token if needed, fetches account + data, maps and inserts.
 */
export async function syncCredential(
  credentialId: number,
): Promise<SyncResult> {
  assertStagingEnv()
  const start = Date.now()

  const credential = await prisma.myDiabbyCredential.findUnique({
    where: { id: credentialId },
  })
  if (!credential || !credential.isActive) {
    throw new Error(`Credential ${credentialId} not found or inactive`)
  }

  try {
    // Ensure valid token
    const token = await ensureValidToken(credential)

    // Fetch account + data from MyDiabby
    const [accountResp, dataResp] = await Promise.all([
      getAccount(token),
      getData(token),
    ])

    // Sync profile
    const profileUpdated = await syncProfile(credential.userId, accountResp.user)

    // Sync health data
    const healthResult = await syncHealthData(
      credential.userId,
      dataResp,
    )

    // Update credential state
    await prisma.myDiabbyCredential.update({
      where: { id: credentialId },
      data: {
        lastSyncAt: new Date(),
        consecutiveErrors: 0,
      },
    })

    const result: SyncResult = {
      credentialId,
      status: "success",
      cgmCount: healthResult.cgmCount,
      glycemiaCount: healthResult.glycemiaCount,
      eventCount: healthResult.eventCount,
      profileUpdated,
      durationMs: Date.now() - start,
    }

    await logSync(result)
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"

    await prisma.myDiabbyCredential.update({
      where: { id: credentialId },
      data: { consecutiveErrors: { increment: 1 } },
    })

    const result: SyncResult = {
      credentialId,
      status: "error",
      cgmCount: 0,
      glycemiaCount: 0,
      eventCount: 0,
      profileUpdated: false,
      errorMessage: msg,
      durationMs: Date.now() - start,
    }

    await logSync(result)
    return result
  }
}

// ── Sync all active credentials ────────────────────────────

/**
 * Sync all active MyDiabby credentials. Called by the hourly cron.
 */
export async function syncAllAccounts(): Promise<SyncResult[]> {
  assertStagingEnv()

  const credentials = await prisma.myDiabbyCredential.findMany({
    where: { isActive: true },
    select: { id: true },
  })

  const results: SyncResult[] = []
  for (const cred of credentials) {
    const result = await syncCredential(cred.id)
    results.push(result)
  }

  return results
}

// ── Disconnect ─────────────────────────────────────────────

/**
 * Remove stored MyDiabby credentials for a user.
 * Does NOT delete imported data — only the sync connection.
 */
export async function disconnectAccount(
  credentialId: number,
  userId: number,
): Promise<void> {
  assertStagingEnv()

  await prisma.myDiabbyCredential.delete({
    where: { id: credentialId },
  })

  await auditService.log({
    userId,
    action: "DELETE",
    resource: "MYDIABBY_CREDENTIAL",
    resourceId: String(credentialId),
  })
}

// ── Get credentials list ───────────────────────────────────

export async function listCredentials(userId: number) {
  assertStagingEnv()

  return prisma.myDiabbyCredential.findMany({
    where: { userId },
    select: {
      id: true,
      mydiabbyUid: true,
      lastSyncAt: true,
      consecutiveErrors: true,
      isActive: true,
      createdAt: true,
      syncLogs: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          status: true,
          cgmCount: true,
          glycemiaCount: true,
          eventCount: true,
          profileUpdated: true,
          errorMessage: true,
          durationMs: true,
          createdAt: true,
        },
      },
    },
  })
}

// ── Internal helpers ───────────────────────────────────────

async function ensureValidToken(
  credential: {
    id: number
    token: string | null
    refreshToken: string | null
    tokenExpiresAt: Date | null
    email: string
    password: string
  },
): Promise<string> {
  // Token still valid (with 5min margin)
  if (
    credential.token &&
    credential.tokenExpiresAt &&
    credential.tokenExpiresAt > new Date(Date.now() + 5 * 60_000)
  ) {
    return credential.token
  }

  // Try refresh
  if (credential.token) {
    try {
      const newToken = await refreshMyDiabbyToken(credential.token)
      await prisma.myDiabbyCredential.update({
        where: { id: credential.id },
        data: {
          token: newToken,
          tokenExpiresAt: new Date(Date.now() + 24 * 3600_000),
        },
      })
      return newToken
    } catch {
      // Refresh failed, try re-auth
    }
  }

  // Re-authenticate with stored credentials
  const email = safeDecryptField(credential.email)
  const password = safeDecryptField(credential.password)
  if (!email || !password) {
    throw new Error("Cannot decrypt stored MyDiabby credentials")
  }

  const authResult = await authenticate(email, password)
  await prisma.myDiabbyCredential.update({
    where: { id: credential.id },
    data: {
      token: authResult.token,
      refreshToken: authResult.refresh_token,
      tokenExpiresAt: new Date(Date.now() + 24 * 3600_000),
    },
  })

  return authResult.token
}

async function syncProfile(
  userId: number,
  mydiabbyUser: import("@/types/mydiabby").MyDiabbyUser,
): Promise<boolean> {
  const mapped = mapUser(mydiabbyUser)

  await prisma.user.update({
    where: { id: userId },
    data: {
      email: encryptField(mapped.email),
      emailHmac: hmacEmail(mapped.email),
      firstname: mapped.firstname ? encryptField(mapped.firstname) : null,
      lastname: mapped.lastname ? encryptField(mapped.lastname) : null,
      birthday: mapped.birthday,
      sex: mapped.sex,
      phone: mapped.phone ? encryptField(mapped.phone) : null,
      country: mapped.country,
      language: mapped.language,
      timezone: mapped.timezone,
      hasSignedTerms: mapped.hasSignedTerms,
      nirpp: mapped.nirpp ? encryptField(mapped.nirpp) : null,
      nirppType: mapped.nirppType,
    },
  })

  // Sync patient if exists
  if (mydiabbyUser.patient) {
    const patientData = mapPatient(mydiabbyUser.patient)
    await prisma.patient.updateMany({
      where: { userId },
      data: { pathology: patientData.pathology },
    })

    // Sync unit preferences
    const unitPrefs = mapUnitPreferences(mydiabbyUser)
    await prisma.userUnitPreferences.upsert({
      where: { userId },
      create: { userId, ...unitPrefs },
      update: unitPrefs,
    })

    // Sync medical data
    if (mydiabbyUser.patient.medicaldata) {
      const medData = mapMedicalData(mydiabbyUser.patient.medicaldata)
      const patient = await prisma.patient.findUnique({ where: { userId } })
      if (patient) {
        await prisma.patientMedicalData.upsert({
          where: { patientId: patient.id },
          create: {
            patientId: patient.id,
            yearDiag: medData.yearDiag,
            insulin: medData.insulin,
            insulinPump: medData.insulinPump,
            tabac: medData.tabac,
            alcool: medData.alcool,
            historyMedical: medData.historyMedical ? encryptField(medData.historyMedical) : null,
            historyChirurgical: medData.historyChirurgical ? encryptField(medData.historyChirurgical) : null,
            historyFamily: medData.historyFamily ? encryptField(medData.historyFamily) : null,
            historyAllergy: medData.historyAllergy ? encryptField(medData.historyAllergy) : null,
            historyVaccine: medData.historyVaccine ? encryptField(medData.historyVaccine) : null,
            historyLife: medData.historyLife ? encryptField(medData.historyLife) : null,
          },
          update: {
            yearDiag: medData.yearDiag,
            insulin: medData.insulin,
            insulinPump: medData.insulinPump,
            tabac: medData.tabac,
            alcool: medData.alcool,
            historyMedical: medData.historyMedical ? encryptField(medData.historyMedical) : null,
            historyChirurgical: medData.historyChirurgical ? encryptField(medData.historyChirurgical) : null,
            historyFamily: medData.historyFamily ? encryptField(medData.historyFamily) : null,
            historyAllergy: medData.historyAllergy ? encryptField(medData.historyAllergy) : null,
            historyVaccine: medData.historyVaccine ? encryptField(medData.historyVaccine) : null,
            historyLife: medData.historyLife ? encryptField(medData.historyLife) : null,
          },
        })
      }
    }
  }

  await auditService.log({
    userId,
    action: "UPDATE",
    resource: "USER",
    resourceId: String(userId),
    metadata: { source: "mydiabby", type: "profile_sync" },
  })

  return true
}

async function syncHealthData(
  userId: number,
  dataResp: import("@/types/mydiabby").MyDiabbyDataResponse,
): Promise<{ cgmCount: number; glycemiaCount: number; eventCount: number }> {
  const patient = await prisma.patient.findUnique({ where: { userId } })
  if (!patient) return { cgmCount: 0, glycemiaCount: 0, eventCount: 0 }

  let cgmCount = 0
  let glycemiaCount = 0
  let eventCount = 0

  // CGM entries
  const cgmEntries = mapCgmEntries(dataResp.data.cgm)
  for (let i = 0; i < cgmEntries.length; i += BATCH_SIZE) {
    const batch = cgmEntries.slice(i, i + BATCH_SIZE)
    const result = await prisma.cgmEntry.createMany({
      data: batch.map((e) => ({
        patientId: patient.id,
        valueGl: e.glucoseValue / 100.0, // mg/dL → g/L for storage
        timestamp: e.timestamp,
        isManual: e.isManual,
      })),
      skipDuplicates: true,
    })
    cgmCount += result.count
  }

  // Glycemia entries
  const glycEntries = mapGlycemiaEntries(dataResp.data.glycemia)
  for (let i = 0; i < glycEntries.length; i += BATCH_SIZE) {
    const batch = glycEntries.slice(i, i + BATCH_SIZE)
    const result = await prisma.glycemiaEntry.createMany({
      data: batch.map((e) => ({
        patientId: patient.id,
        date: e.timestamp,
        glycemiaGl: e.glucoseValue / 100.0, // mg/dL → g/L
        glycemiaMgdl: e.glucoseValue,
      })),
      skipDuplicates: true,
    })
    glycemiaCount += result.count
  }

  // Insulin flow entries
  const flowEntries = mapInsulinFlowEntries(dataResp.data.insulinflow)
  for (let i = 0; i < flowEntries.length; i += BATCH_SIZE) {
    const batch = flowEntries.slice(i, i + BATCH_SIZE)
    await prisma.insulinFlowEntry.createMany({
      data: batch.map((e) => ({
        patientId: patient.id,
        date: e.timestamp,
        flow: e.value,
      })),
      skipDuplicates: true,
    })
    eventCount += batch.length
  }

  // Meal/snack events
  const mealEvents = mapSnackEntries(dataResp.data.snack)
  for (let i = 0; i < mealEvents.length; i += BATCH_SIZE) {
    const batch = mealEvents.slice(i, i + BATCH_SIZE)
    await prisma.diabetesEvent.createMany({
      data: batch.map((e) => ({
        patientId: patient.id,
        eventTypes: ["insulinMeal"],
        eventDate: e.timestamp,
        carbohydrates: e.carbsGrams,
      })),
      skipDuplicates: true,
    })
    eventCount += batch.length
  }

  await auditService.log({
    userId,
    action: "IMPORT",
    resource: "CGM_ENTRY",
    resourceId: String(patient.id),
    metadata: { source: "mydiabby", cgmCount, glycemiaCount, eventCount },
  })

  return { cgmCount, glycemiaCount, eventCount }
}

async function logSync(result: SyncResult): Promise<void> {
  await prisma.myDiabbySyncLog.create({
    data: {
      credentialId: result.credentialId,
      status: result.status,
      cgmCount: result.cgmCount,
      glycemiaCount: result.glycemiaCount,
      eventCount: result.eventCount,
      profileUpdated: result.profileUpdated,
      errorMessage: result.errorMessage || null,
      durationMs: result.durationMs,
    },
  })
}
