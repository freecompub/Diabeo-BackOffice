/**
 * fetchWithTimeout — `fetch` avec `AbortController` + timeout configurable.
 *
 * Fix FE H5 round 1 review PR #449 (Issue #446) — sans timeout, si le backend
 * est lent ou down (network partition, 502 OVH LB, timeout reverse proxy),
 * `fetch()` peut hang 30s+ (default browser network timeout). Côté logout
 * flow, l'utilisateur attend la redirection `/login` pendant tout ce temps
 * → UX catastrophique sur poste partagé HDS où la sortie de session doit
 * être immédiate.
 *
 * **Comportement** :
 * - Si la requête termine sous `timeoutMs` → résolu avec la Response normale.
 * - Si timeout dépasse → throw `DOMException("The operation was aborted.")`.
 * - Si caller passe son propre `signal` dans `init`, on chain via composite :
 *   le caller peut toujours abort manuellement (UX cancel button futur).
 *
 * Utilisé par `useAuth.logout` (POST `/api/auth/logout` + DELETE
 * `/api/push/register`).
 *
 * **Note** : on retourne une Promise<Response> standard — caller continue
 * d'utiliser `.ok`, `.json()`, etc. comme avec `fetch` natif.
 */

const DEFAULT_TIMEOUT_MS = 5_000

export interface FetchWithTimeoutOptions extends RequestInit {
  /** Timeout en millisecondes. Défaut : 5000ms (cohérent UX logout). */
  timeoutMs?: number
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...init } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  // Si le caller passe son propre signal, on chain : abort si l'un OU l'autre.
  let chainAbortListener: (() => void) | null = null
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timeoutId)
      controller.abort()
    } else {
      chainAbortListener = () => controller.abort()
      callerSignal.addEventListener("abort", chainAbortListener, { once: true })
    }
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
    if (callerSignal && chainAbortListener) {
      callerSignal.removeEventListener("abort", chainAbortListener)
    }
  }
}
