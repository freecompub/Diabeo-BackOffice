import { initializeApp, cert, getApps, type App } from "firebase-admin/app"
import { getMessaging, type Messaging } from "firebase-admin/messaging"
import { z } from "zod"

const serviceAccountSchema = z.object({
  type: z.literal("service_account"),
  project_id: z.string().min(1),
  private_key: z.string().includes("BEGIN"),
  client_email: z.string().email(),
}).passthrough()

let _app: App | null = null

function getFirebaseApp(): App {
  if (_app) return _app
  const existing = getApps()
  if (existing.length > 0 && existing[0]) {
    _app = existing[0]
    return _app
  }

  const encodedKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  if (!encodedKey) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY not configured")
  }

  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(encodedKey, "base64").toString("utf-8"))
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY contains invalid base64 or JSON")
  }

  const parsed = serviceAccountSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY missing required fields (type, project_id, private_key, client_email)")
  }

  _app = initializeApp({
    credential: cert(parsed.data as Record<string, string>),
    projectId: process.env.FIREBASE_PROJECT_ID ?? parsed.data.project_id,
  })

  return _app
}

export function getFcm(): Messaging {
  return getMessaging(getFirebaseApp())
}
