"use client"

/**
 * Dashboard layout — sidebar + header + content area.
 * All pages under (dashboard) require authentication.
 */

import { Sidebar } from "@/components/diabeo/Sidebar"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-background)]">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
