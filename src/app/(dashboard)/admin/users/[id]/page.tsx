/**
 * US-2148 — User detail + actions admin.
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { UserDetailClient } from "@/components/diabeo/admin/UserDetailClient"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function UserDetailPage({ params }: PageProps) {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  const { id } = await params
  if (!/^[1-9]\d{0,9}$/.test(id)) {
    redirect("/admin/users")
  }
  const userId = Number.parseInt(id, 10)

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <UserDetailClient userId={userId} />
    </main>
  )
}
