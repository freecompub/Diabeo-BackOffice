"use client"

/**
 * Dashboard sidebar — main navigation for the backoffice.
 * Displays navigation links with icons, user role badge, and logout button.
 */

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  Settings,
  FileText,
  LogOut,
  Activity,
  Pill,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"

const navItems = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/patients", label: "Patients", icon: Users },
  { href: "/medications", label: "Médicaments", icon: Pill },
  { href: "/analytics", label: "Analytics", icon: Activity },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/settings", label: "Paramètres", icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const { logout } = useAuth()

  return (
    <aside
      className="flex h-screen w-64 flex-col border-r border-[var(--color-border)] bg-white"
      aria-label="Navigation principale"
    >
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-[var(--color-border)] px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-primary)]">
          <span className="text-sm font-bold text-white">D</span>
        </div>
        <span className="text-lg font-semibold text-[var(--color-foreground)]">
          Diabeo
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Menu principal">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[var(--color-primary-50)] text-[var(--color-primary)]"
                  : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]",
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Logout */}
      <div className="border-t border-[var(--color-border)] p-3">
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-[var(--color-muted-foreground)] transition-colors hover:bg-red-50 hover:text-red-600"
          aria-label="Se déconnecter"
        >
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
          Se déconnecter
        </button>
      </div>
    </aside>
  )
}
