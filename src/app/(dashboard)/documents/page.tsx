"use client"

/**
 * Documents page — WEB-206.
 *
 * Displays the authenticated user's medical documents with:
 * - Real-time search by title
 * - Grouping by source/category (expandable sections)
 * - Document preview: PDF in new tab, images in a dialog
 * - Upload via FormData POST with progress indicator
 * - States: loading, error, empty, no search results
 *
 * Security:
 * - All API calls use credentials: "include" + X-Requested-With header
 * - File types restricted to PDF, PNG, JPG, JPEG
 * - Max upload size enforced server-side (50 MB)
 *
 * Accessibility:
 * - Dialog has accessible title and close button
 * - File input triggered via a visible button (not hidden)
 * - aria-live region for upload progress and errors
 * - Expandable sections use <details>/<summary> for keyboard support
 */

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  FileText,
  Image,
  Upload,
  Download,
  Search,
  ChevronDown,
  ChevronRight,
  X,
  AlertTriangle,
  Loader2,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { DashboardHeader } from "@/components/diabeo/DashboardHeader"
import {
  DiabeoButton,
  DiabeoCard,
  DiabeoEmptyState,
} from "@/components/diabeo"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DocumentCategory =
  | "general"
  | "forDoctor"
  | "personal"
  | "prescription"
  | "labResults"
  | "other"

interface MedicalDocument {
  id: number
  title: string
  category: DocumentCategory
  mimeType: string
  fileSize: number
  createdAt: string
  /** Presigned URL for preview / download (populated on first access) */
  url?: string
}

interface GroupedDocuments {
  category: DocumentCategory
  documents: MedicalDocument[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const API_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
} as const

function isPdf(mimeType: string): boolean {
  return mimeType === "application/pdf"
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/")
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function groupByCategory(docs: MedicalDocument[]): GroupedDocuments[] {
  const map = new Map<DocumentCategory, MedicalDocument[]>()

  for (const doc of docs) {
    const cat = doc.category ?? "other"
    const existing = map.get(cat)
    if (existing) {
      existing.push(doc)
    } else {
      map.set(cat, [doc])
    }
  }

  return Array.from(map.entries()).map(([category, documents]) => ({
    category,
    documents,
  }))
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface DocumentRowProps {
  doc: MedicalDocument
  onPreview: (doc: MedicalDocument) => void
  onDownload: (doc: MedicalDocument) => void
  tDocs: ReturnType<typeof useTranslations<"documents">>
}

function DocumentRow({ doc, onPreview, onDownload, tDocs }: DocumentRowProps) {
  const isPreviewable = isPdf(doc.mimeType) || isImage(doc.mimeType)

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50"
    >
      {/* Icon + info */}
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="shrink-0 text-muted-foreground [&_svg]:size-5"
          aria-hidden="true"
        >
          {isImage(doc.mimeType) ? <Image /> : <FileText />}
        </span>
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => isPreviewable && onPreview(doc)}
            disabled={!isPreviewable}
            className={cn(
              "block truncate text-sm font-medium text-foreground text-left",
              isPreviewable
                ? "cursor-pointer hover:text-teal-600 focus-visible:outline-2 focus-visible:outline-teal-600"
                : "cursor-default"
            )}
            aria-label={
              isPreviewable
                ? tDocs("previewDocument", { title: doc.title })
                : doc.title
            }
          >
            {doc.title}
          </button>
          <p className="text-xs text-muted-foreground">
            {formatDate(doc.createdAt)} &middot; {formatFileSize(doc.fileSize)}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onDownload(doc)}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-gray-100 hover:text-teal-600 focus-visible:outline-2 focus-visible:outline-teal-600"
          aria-label={tDocs("downloadDocument", { title: doc.title })}
        >
          <Download className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

interface CategorySectionProps {
  group: GroupedDocuments
  defaultOpen?: boolean
  onPreview: (doc: MedicalDocument) => void
  onDownload: (doc: MedicalDocument) => void
  tDocs: ReturnType<typeof useTranslations<"documents">>
}

function CategorySection({
  group,
  defaultOpen = true,
  onPreview,
  onDownload,
  tDocs,
}: CategorySectionProps) {
  return (
    <details open={defaultOpen} className="group">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2",
          "text-sm font-semibold text-foreground",
          "hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-teal-600"
        )}
      >
        <span
          className="shrink-0 transition-transform group-open:rotate-0 -rotate-90"
          aria-hidden="true"
        >
          <ChevronDown className="size-4 text-muted-foreground" />
        </span>
        {tDocs(`category.${group.category}`)}
        <span className="ms-auto text-xs font-normal text-muted-foreground">
          {group.documents.length}
        </span>
      </summary>

      <div className="mt-1 ms-4 flex flex-col">
        {group.documents.map((doc) => (
          <DocumentRow
            key={doc.id}
            doc={doc}
            onPreview={onPreview}
            onDownload={onDownload}
            tDocs={tDocs}
          />
        ))}
      </div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Upload progress bar
// ---------------------------------------------------------------------------

interface UploadProgressBarProps {
  progress: number
  fileName: string
}

function UploadProgressBar({ progress, fileName }: UploadProgressBarProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Envoi de ${fileName} : ${progress}%`}
      className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3"
    >
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="truncate font-medium text-teal-700">{fileName}</span>
        <span className="ms-2 shrink-0 font-medium text-teal-700">
          {progress}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-teal-100">
        <div
          className="h-full rounded-full bg-teal-600 transition-all duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DocumentsPage() {
  const tDocs = useTranslations("documents")
  const tCommon = useTranslations("common")

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const [documents, setDocuments] = React.useState<MedicalDocument[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState("")

  // Upload
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = React.useState(false)
  const [uploadProgress, setUploadProgress] = React.useState(0)
  const [uploadFileName, setUploadFileName] = React.useState("")
  const [uploadError, setUploadError] = React.useState<string | null>(null)

  // Preview dialog
  const [previewDoc, setPreviewDoc] = React.useState<MedicalDocument | null>(
    null
  )
  const [previewOpen, setPreviewOpen] = React.useState(false)

  // -------------------------------------------------------------------------
  // Load documents
  // -------------------------------------------------------------------------
  const loadDocuments = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const res = await fetch("/api/documents", {
        credentials: "include",
        headers: API_HEADERS,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setLoadError(data.error ?? tCommon("error"))
        return
      }
      const data: MedicalDocument[] = await res.json()
      setDocuments(data)
    } catch {
      setLoadError(tCommon("error"))
    } finally {
      setIsLoading(false)
    }
  }, [tCommon])

  React.useEffect(() => {
    void loadDocuments()
  }, [loadDocuments])

  // -------------------------------------------------------------------------
  // Filtered + grouped
  // -------------------------------------------------------------------------
  const filtered = React.useMemo(() => {
    if (!search.trim()) return documents
    const q = search.toLowerCase()
    return documents.filter((d) => d.title.toLowerCase().includes(q))
  }, [documents, search])

  const grouped = React.useMemo(() => groupByCategory(filtered), [filtered])

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------
  const ALLOWED_MIME_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const

  const handleFileChange = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ""

      // Client-side file size validation (50 MB)
      if (file.size > 50 * 1024 * 1024) {
        setUploadError(tDocs("fileTooLarge"))
        return
      }

      // Client-side MIME type validation
      if (!ALLOWED_MIME_TYPES.includes(file.type as typeof ALLOWED_MIME_TYPES[number])) {
        setUploadError(tDocs("invalidFileType"))
        return
      }

      setUploadError(null)
      setUploading(true)
      setUploadFileName(file.name)
      setUploadProgress(0)

      try {
        // Build FormData
        const formData = new FormData()
        formData.append("file", file)
        formData.append("title", file.name)
        formData.append("mimeType", file.type)
        formData.append("fileSize", String(file.size))

        // Use XHR for progress events
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open("POST", "/api/documents")
          xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest")
          xhr.withCredentials = true

          xhr.upload.onprogress = (ev) => {
            if (ev.lengthComputable) {
              setUploadProgress(Math.round((ev.loaded / ev.total) * 100))
            }
          }

          xhr.onload = () => {
            if (xhr.status === 201 || xhr.status === 200) {
              resolve()
            } else {
              try {
                const body = JSON.parse(xhr.responseText) as { error?: string }
                reject(new Error(body.error ?? tDocs("uploadError")))
              } catch {
                reject(new Error(tDocs("uploadError")))
              }
            }
          }

          xhr.onerror = () => reject(new Error(tDocs("uploadError")))
          xhr.send(formData)
        })

        setUploadProgress(100)
        // Reload document list
        await loadDocuments()
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : tDocs("uploadError"))
      } finally {
        setUploading(false)
        setUploadProgress(0)
        setUploadFileName("")
      }
    },
    [loadDocuments, tDocs]
  )

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------
  const handlePreview = React.useCallback((doc: MedicalDocument) => {
    if (isPdf(doc.mimeType)) {
      // PDFs open in a new tab
      if (doc.url) {
        window.open(doc.url, "_blank", "noopener,noreferrer")
      }
      return
    }
    // Images open in the dialog
    setPreviewDoc(doc)
    setPreviewOpen(true)
  }, [])

  // -------------------------------------------------------------------------
  // Download
  // -------------------------------------------------------------------------
  const handleDownload = React.useCallback((doc: MedicalDocument) => {
    if (!doc.url) return
    const a = document.createElement("a")
    a.href = doc.url
    a.download = doc.title
    a.rel = "noopener noreferrer"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [])

  // -------------------------------------------------------------------------
  // Render states
  // -------------------------------------------------------------------------
  const renderContent = () => {
    if (isLoading) {
      return (
        <div
          role="status"
          aria-live="polite"
          aria-label={tCommon("loading")}
          className="flex items-center justify-center py-16"
        >
          <Loader2
            className="size-8 animate-spin text-teal-600"
            aria-hidden="true"
          />
        </div>
      )
    }

    if (loadError) {
      return (
        <DiabeoEmptyState
          variant="error"
          action={{ label: tCommon("retry"), onClick: loadDocuments }}
        />
      )
    }

    if (documents.length === 0) {
      return (
        <DiabeoEmptyState
          variant="noData"
          title={tDocs("empty.title")}
          message={tDocs("empty.message")}
        />
      )
    }

    if (filtered.length === 0) {
      return (
        <DiabeoEmptyState
          variant="noSearchResults"
          title={tDocs("noResults.title")}
          message={tDocs("noResults.message", { query: search })}
        />
      )
    }

    return (
      <div className="flex flex-col gap-2">
        {grouped.map((group) => (
          <CategorySection
            key={group.category}
            group={group}
            defaultOpen={grouped.length <= 3}
            onPreview={handlePreview}
            onDownload={handleDownload}
            tDocs={tDocs}
          />
        ))}
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Page
  // -------------------------------------------------------------------------
  return (
    <>
      <DashboardHeader
        title={tDocs("title")}
        subtitle={
          !isLoading && !loadError
            ? tDocs("subtitle", { count: documents.length })
            : undefined
        }
      />

      <div className="space-y-4 p-6">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 sm:max-w-sm">
            <Search
              className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder={tDocs("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ps-10"
              aria-label={tDocs("searchPlaceholder")}
            />
          </div>

          {/* Import button */}
          <DiabeoButton
            variant="diabeoPrimary"
            icon={<Upload aria-hidden="true" />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            loading={uploading}
            aria-label={tDocs("importButton")}
          >
            {tDocs("importButton")}
          </DiabeoButton>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg"
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={handleFileChange}
          />
        </div>

        {/* Upload progress */}
        {uploading && uploadFileName && (
          <UploadProgressBar
            progress={uploadProgress}
            fileName={uploadFileName}
          />
        )}

        {/* Upload error */}
        {uploadError && (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span>{uploadError}</span>
            <button
              type="button"
              onClick={() => setUploadError(null)}
              className="ms-auto rounded p-0.5 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-red-600"
              aria-label={tCommon("close")}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Document list */}
        <DiabeoCard variant="outlined" padding="md">
          {renderContent()}
        </DiabeoCard>
      </div>

      {/* Image preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewDoc?.title}</DialogTitle>
            <DialogDescription>
              {previewDoc
                ? `${formatDate(previewDoc.createdAt)} \u00b7 ${formatFileSize(previewDoc.fileSize)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {previewDoc?.url && isImage(previewDoc.mimeType) && (
            <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg bg-gray-50 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewDoc.url}
                alt={previewDoc.title}
                className="max-h-[65vh] w-auto object-contain"
              />
            </div>
          )}
          {!previewDoc?.url && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {tDocs("previewUnavailable")}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
