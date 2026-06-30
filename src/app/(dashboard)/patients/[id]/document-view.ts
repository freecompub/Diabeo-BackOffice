/**
 * Mapping pur (testable) des documents médicaux vers la vue dossier (Phase 4).
 *
 * Aucune dépendance RSC/Prisma. La liste vient déjà scopée + auditée + sans
 * `fileUrl` (omis par le service) — ici on ne fait que projeter les champs
 * d'affichage + formater la taille de fichier. Le téléchargement passe par la
 * route `/api/documents/[id]/download` (auth + scope serveur ; fichiers scannés
 * ClamAV à l'upload, pas au download).
 */

// Types de vue dans un module neutre (US-2632) : ré-exportés + importés ci-dessous.
export type { DocSize, DocumentItem } from "@/components/diabeo/patient/patient-record-views"
import type { DocSize, DocumentItem } from "@/components/diabeo/patient/patient-record-views"

const KB = 1024
const MB = 1024 * 1024

/** Octets → {valeur, clé d'unité i18n}. `null` si taille inconnue. */
export function formatDocSize(bytes: number | null | undefined): DocSize {
  if (bytes === null || bytes === undefined || bytes < 0) return null
  if (bytes < KB) return { value: bytes, unitKey: "sizeBytes" }
  if (bytes < MB) return { value: Math.round((bytes / KB) * 10) / 10, unitKey: "sizeKb" }
  return { value: Math.round((bytes / MB) * 10) / 10, unitKey: "sizeMb" }
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
