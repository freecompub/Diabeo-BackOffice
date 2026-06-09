/**
 * Auth layout — centered card without sidebar/header.
 * Used for login and password reset pages.
 *
 * US-2112b AC-1 — un sélecteur de langue (mode non-persistant : cookie client,
 * aucun appel authentifié) est affiché en haut à droite pour qu'un visiteur
 * puisse choisir FR/EN/AR avant même de se connecter.
 */

import { LocaleSwitcher } from "@/components/diabeo/LocaleSwitcher"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-background)] px-4">
      <div className="flex justify-end pt-4">
        <LocaleSwitcher persist={false} variant="compact" />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  )
}
