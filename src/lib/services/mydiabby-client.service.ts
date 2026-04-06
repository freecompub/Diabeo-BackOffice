/**
 * MyDiabby API client — HTTP calls to app.mydiabby.com.
 *
 * This service is used ONLY in staging environment for data synchronization.
 * It wraps the MyDiabby REST API (JWT RS256 auth, PHP backend).
 *
 * Endpoints used:
 * - POST /api/getToken — authenticate with email/password
 * - POST /api/account — get user profile + patient data
 * - GET  /api/data    — get health data (CGM, glycemia, insulin flow)
 * - GET  /api/fastttljwt — refresh JWT token
 *
 * @see DiabeoDoc/Datamanager/MyDiabby_API_Analysis.md
 */

import type {
  MyDiabbyAuthResponse,
  MyDiabbyAccountResponse,
  MyDiabbyDataResponse,
  MyDiabbyRefreshResponse,
} from "@/types/mydiabby"

const MYDIABBY_BASE_URL = "https://app.mydiabby.com"
const PLATFORM = "dt0"
const REQUEST_TIMEOUT_MS = 30_000

function assertStagingEnv(): void {
  if (process.env.APP_ENV !== "staging") {
    throw new Error("[mydiabby-client] MyDiabby sync is only available in staging")
  }
}

async function mydiabbyFetch(
  path: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = REQUEST_TIMEOUT_MS, ...fetchOptions } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(`${MYDIABBY_BASE_URL}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
    })
    return response
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Authenticate with MyDiabby credentials.
 * Returns JWT token, refresh token, and user metadata.
 */
export async function authenticate(
  email: string,
  password: string,
): Promise<MyDiabbyAuthResponse> {
  assertStagingEnv()

  const body = new URLSearchParams({
    username: email,
    password,
    platform: PLATFORM,
  })

  const response = await mydiabbyFetch("/api/getToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  if (!response.ok) {
    throw new Error(`MyDiabby auth failed: ${response.status}`)
  }

  const data = await response.json()
  if (!data.token) {
    throw new Error("MyDiabby auth: no token in response")
  }

  return data as MyDiabbyAuthResponse
}

/**
 * Get the full user account from MyDiabby (profile + patient + objectives + treatment).
 */
export async function getAccount(
  token: string,
): Promise<MyDiabbyAccountResponse> {
  assertStagingEnv()

  const response = await mydiabbyFetch("/api/account", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  })

  if (!response.ok) {
    throw new Error(`MyDiabby getAccount failed: ${response.status}`)
  }

  const data = await response.json()
  if (!data.success) {
    throw new Error(`MyDiabby getAccount error: ${data.errors?.join(", ")}`)
  }

  return data as MyDiabbyAccountResponse
}

/**
 * Get health data from MyDiabby (CGM, glycemia, insulin flow, pump events).
 */
export async function getData(
  token: string,
): Promise<MyDiabbyDataResponse> {
  assertStagingEnv()

  const response = await mydiabbyFetch("/api/data", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`MyDiabby getData failed: ${response.status}`)
  }

  const data = await response.json()
  return data as MyDiabbyDataResponse
}

/**
 * Refresh a MyDiabby JWT token before it expires.
 */
export async function refreshMyDiabbyToken(
  token: string,
): Promise<string> {
  assertStagingEnv()

  const response = await mydiabbyFetch("/api/fastttljwt", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`MyDiabby token refresh failed: ${response.status}`)
  }

  const data: MyDiabbyRefreshResponse = await response.json()
  if (!data.success || !data.token) {
    throw new Error("MyDiabby token refresh: no token in response")
  }

  return data.token
}
