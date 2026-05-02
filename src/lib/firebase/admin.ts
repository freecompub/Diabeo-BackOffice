import { initializeApp, cert, getApps, type App } from "firebase-admin/app"
import { getMessaging, type Messaging } from "firebase-admin/messaging"

let _app: App | null = null

function getFirebaseApp(): App {
  if (_app) return _app
  const existing = getApps()
  if (existing.length > 0) {
    _app = existing[0]
    return _app
  }

  const encodedKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  if (!encodedKey) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_KEY not configured")
  }

  const serviceAccount = JSON.parse(
    Buffer.from(encodedKey, "base64").toString("utf-8"),
  )

  _app = initializeApp({
    credential: cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID ?? serviceAccount.project_id,
  })

  return _app
}

export function getFcm(): Messaging {
  return getMessaging(getFirebaseApp())
}
