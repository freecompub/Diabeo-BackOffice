"use client"

/**
 * useAutoClearAfter — auto-clear un state value après N ms.
 *
 * Fix CR-3 + HSA-1 + FE-3 + CR-12 round 1 review PR #435 — refactor du
 * pattern `setTimeout(() => setX(null), 4000)` qui était dupliqué dans
 * `AppointmentCalendar.tsx` (iter 6 `justCreated`, iter 7 `dndError`)
 * SANS cleanup useEffect → 3 bugs latents :
 *   - fuite mémoire : timer fire après unmount du composant
 *   - setState-on-unmounted warn React (silent React 18+, mais bug latent)
 *   - concurrent timers : si `value` change avant 4s, l'ancien timer
 *     clear le NOUVEAU value prématurément
 *
 * **Pattern** : `useEffect([value, ms])` qui démarre un `setTimeout(setter,
 * ms)` quand value devient truthy, et clear au cleanup (unmount OU change
 * de value). React 19-compatible (pas de setState dans le body — uniquement
 * dans le timer callback).
 *
 * **Usage** :
 * ```tsx
 * const [error, setError] = useState<string | null>(null)
 * useAutoClearAfter(error, () => setError(null), 4000)
 * ```
 *
 * @param value valeur à observer (truthy/falsy)
 * @param clear callback appelé après `ms` si value reste truthy
 * @param ms délai en millisecondes (default 4000)
 */

import { useEffect } from "react"

export function useAutoClearAfter(
  value: unknown,
  clear: () => void,
  ms: number = 4000,
): void {
  useEffect(() => {
    if (!value) return
    const timer = setTimeout(clear, ms)
    return () => clearTimeout(timer)
    // `clear` est expected stable (useCallback côté caller) ; sinon le
    // timer reset à chaque render. Le caller assume responsabilité.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear stable assumed
  }, [value, ms])
}
