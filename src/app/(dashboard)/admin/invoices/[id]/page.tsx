/**
 * US-2102 — Invoice detail + PDF download (ADMIN).
 */
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { InvoiceDetailClient } from "@/components/diabeo/admin/InvoiceDetailClient"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const headersList = await headers()
  const role = headersList.get("x-user-role")
  if (role !== "ADMIN") redirect("/")

  const { id } = await params
  // Regex stricte (cf. fix H5 PR #459) — anti audit pollution US-2268.
  if (!/^[1-9]\d{0,9}$/.test(id)) {
    redirect("/admin/invoices")
  }
  const invoiceId = Number.parseInt(id, 10)

  return (
    <main className="flex flex-col gap-6 p-4 lg:p-6">
      <InvoiceDetailClient invoiceId={invoiceId} />
    </main>
  )
}
