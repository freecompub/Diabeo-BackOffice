"use client"

/**
 * UnreadCountContext — single-source `useUnreadCount` pour tout le shell.
 *
 * Fix B2 round 1 review PR #440 — `<SidebarNav>` est rendu 2× dans
 * `NavigationShell` (desktop sticky sidebar + mobile Sheet overlay).
 * Sans Provider, chaque instance instancie son propre `useUnreadCount` :
 *   - 2 setInterval 60s simultanés → 2× quota backend
 *   - 2 visibilitychange listeners → race condition
 *   - decrement local d'une instance ne propage pas → désynchro badge
 *     desktop vs mobile après markRead
 *
 * **Pattern** : Provider monté dans `NavigationShell` au niveau parent,
 * consume via `useUnreadCountFromContext()` dans `SidebarNav`. Fallback
 * `null` si Provider absent (tests unit hors-shell).
 *
 * **Sécurité** : Provider skip le fetch si aucun item `showUnreadBadge`
 * (cf. `hasBadgeItem` check) — pas de fetch parasite sur tout l'app.
 */

import { createContext, useContext, type ReactNode } from "react"
import { useUnreadCount, type UseUnreadCountResult } from "./useUnreadCount"

const UnreadCountContext = createContext<UseUnreadCountResult | null>(null)

export interface UnreadCountProviderProps {
  children: ReactNode
  /** Skip fetching entirely (e.g., aucun item showUnreadBadge dans nav). */
  skip?: boolean
  /** Override interval pour tests. Default 60_000ms. */
  refreshInterval?: number
}

/**
 * Provider unique du `useUnreadCount`. Doit être monté UNE FOIS dans
 * `NavigationShell` (ou layout dashboard).
 */
export function UnreadCountProvider({
  children,
  skip = false,
  refreshInterval,
}: UnreadCountProviderProps) {
  const value = useUnreadCount({ skip, refreshInterval })
  return (
    <UnreadCountContext.Provider value={value}>
      {children}
    </UnreadCountContext.Provider>
  )
}

/**
 * Consume le `useUnreadCount` du Provider parent. Retourne `null` si
 * Provider absent (tests unit isolés). Le caller doit gérer le null
 * (typiquement : ne pas afficher le badge).
 */
export function useUnreadCountFromContext(): UseUnreadCountResult | null {
  return useContext(UnreadCountContext)
}
