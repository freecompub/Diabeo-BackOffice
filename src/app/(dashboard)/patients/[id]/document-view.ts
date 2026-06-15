/**
 * Mapping pur (testable) des documents médicaux vers la vue dossier (Phase 4).
 *
 * Aucune dépendance RSC/Prisma. La liste vient déjà scopée + auditée + sans
 * `fileUrl` (omis par le service) — ici on ne fait que projeter les champs
 * d'affichage + formater la taille de fichier. Le téléchargement passe par la
 * route `/api/documents/[id]/download` (auth + scope + ClamAV côté serveur).
 */

export type DocSize = { value: number; unitKey: "sizeBytes" | "sizeKb" | "sizeMb" } | null

const KB = 1024
const MB = 1024 * 1024

/** Octets → {valeur, clé d'unité i18n}. `null` si taille inconnue. */
export function formatDocSize(bytes: number | null | undefined): DocSize {
  if (bytes === null || bytes === undefined || bytes < 0) return null
  if (bytes < KB) return { value: bytes, unitKey: "sizeBytes" }
  if (bytes < MB) return { value: Math.round((bytes / KB) * 10) / 10, unitKey: "sizeKb" }
  return { value: Math.round((bytes / MB) * 10) / 10, unitKey: "sizeMb" }
}

export type DocumentItem = {
  id: number
  title: string
  category: string | null
  dateIso: string
  size: DocSize
}

type RawDoc = {
  id: number
  title: string
  category: string | null
  date: Date | string
  fileSize: number | null
}

export function buildDocumentView(docs: RawDoc[]): DocumentItem[] {
  return docs.map((d) => ({
    id: d.id,
    title: d.title,
    category: d.category,
    dateIso: typeof d.date === "string" ? d.date : d.date.toISOString(),
    size: formatDocSize(d.fileSize),
  }))
}
