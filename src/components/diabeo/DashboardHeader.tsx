"use client"

/**
 * Dashboard header — displays page title and user menu.
 */

import { Bell, User, LogOut, Settings } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"

interface DashboardHeaderProps {
  title: string
  subtitle?: string
}

export function DashboardHeader({ title, subtitle }: DashboardHeaderProps) {
  const { logout } = useAuth()

  return (
    <header className="flex h-16 items-center justify-between border-b border-[var(--color-border)] bg-white px-6">
      <div>
        <h1 className="text-lg font-semibold text-[var(--color-foreground)]">
          {title}
        </h1>
        {subtitle && (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          className="rounded-lg p-2 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
        </button>

        <button
          className="rounded-lg p-2 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
          aria-label="Parametres"
        >
          <Settings className="h-5 w-5" aria-hidden="true" />
        </button>

        <button
          onClick={logout}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-muted-foreground)] transition-colors hover:bg-red-50 hover:text-red-600"
          aria-label="Se deconnecter"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Deconnexion</span>
        </button>
      </div>
    </header>
  )
}
