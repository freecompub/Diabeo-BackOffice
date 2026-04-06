/**
 * Auth layout — centered card without sidebar/header.
 * Used for login and password reset pages.
 */

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4">
      <div className="w-full max-w-md">
        {children}
      </div>
    </div>
  )
}
