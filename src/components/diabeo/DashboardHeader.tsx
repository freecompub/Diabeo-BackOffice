/**
 * Dashboard header — displays page title and user menu.
 */

import { Bell, Settings } from "lucide-react"

interface DashboardHeaderProps {
  title: string
  subtitle?: string
}

export function DashboardHeader({ title, subtitle }: DashboardHeaderProps) {
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
          className="rounded-lg p-2 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
        </button>

        <button
          className="rounded-lg p-2 text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          aria-label="Paramètres"
        >
          <Settings className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
