"use client"

/** US-2018b — Onglet « Documents » : documents médicaux du patient consulté. */

import { FileText } from "lucide-react"
import { DiabeoEmptyState } from "@/components/diabeo/DiabeoEmptyState"
import { useConsultationData } from "../useConsultationData"
import { TabError, TabLoading } from "./TabState"

interface DocItem {
  id: number | string
  title: string
  date: string | null
  category: string | null
}

export function DocumentsTab({ cTok }: { cTok: string }) {
  const { data, loading, error } = useConsultationData<DocItem[]>("/api/documents", cTok)

  if (loading) return <TabLoading />
  if (error) return <TabError />
  if (!data || data.length === 0) return <DiabeoEmptyState variant="noData" />

  return (
    <ul className="space-y-2">
      {data.map((doc) => (
        <li
          key={doc.id}
          className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
        >
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex-1 truncate text-sm font-medium text-foreground">{doc.title}</span>
          {doc.category && <span className="text-xs text-muted-foreground">{doc.category}</span>}
          <span className="text-xs text-muted-foreground">
            {doc.date ? new Date(doc.date).toLocaleDateString("fr-FR") : "—"}
          </span>
        </li>
      ))}
    </ul>
  )
}
