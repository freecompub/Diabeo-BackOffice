/**
 * @module db/prisma-errors
 * @description Helpers de reconnaissance d'erreurs Prisma, robustes à la stack Prisma 7 + driver adapter.
 *
 * ⚠️ Prisma 7 (`@prisma/adapter-pg`) a changé la forme de `PrismaClientKnownRequestError.meta` :
 * pour un `P2002` (violation d'unicité), **`meta.target` est désormais `undefined`**. Le nom de la
 * contrainte violée ne vit plus que dans `meta.driverAdapterError.cause.originalMessage` (message SQL brut
 * type `duplicate key value violates unique constraint "<name>"`) et/ou `…cause.constraint`. Le code qui ne
 * lit que `meta.target` (pattern legacy pré-adapter) ne matche donc **jamais** en production → le P2002 brut
 * remonte au lieu de l'erreur métier attendue. Ce helper lit les DEUX formes (nouvelle + legacy fallback).
 */

/** Forme partielle d'un `PrismaClientKnownRequestError` couvrant legacy + driver adapter (Prisma 7). */
type PrismaErrorLike = {
  code?: string
  meta?: {
    /** Legacy engine (pré-adapter) : colonnes ou nom d'index. */
    target?: unknown
    /** Prisma 7 + adapter-pg : le nom de contrainte est dans le message SQL brut. */
    driverAdapterError?: {
      cause?: {
        originalMessage?: string
        constraint?: { index?: string; fields?: string[] }
      }
    }
  }
}

/**
 * Vrai si `e` est une violation de contrainte unique (`P2002`) dont l'identité (nom d'index/contrainte,
 * colonnes, ou message SQL) contient `fragment`. Restreindre au fragment évite de re-mapper à tort
 * n'importe quel P2002 sans rapport (cf. revue adjustment.service).
 *
 * @param e - erreur capturée (unknown).
 * @param fragment - sous-chaîne discriminante du nom d'index/contrainte (ex. `"one_pending"`).
 */
export function isUniqueViolationOn(e: unknown, fragment: string): boolean {
  const err = e as PrismaErrorLike
  if (err?.code !== "P2002") return false

  // Legacy : meta.target = string[] (colonnes) ou string.
  const target = Array.isArray(err.meta?.target)
    ? err.meta!.target.join(",")
    : String(err.meta?.target ?? "")

  // Prisma 7 + adapter-pg : nom de contrainte dans le message SQL brut / constraint.
  const cause = err.meta?.driverAdapterError?.cause
  const causeMsg = cause?.originalMessage ?? ""
  const causeIndex = cause?.constraint?.index ?? ""
  const causeFields = Array.isArray(cause?.constraint?.fields) ? cause.constraint!.fields!.join(",") : ""

  return (
    target.includes(fragment) ||
    causeMsg.includes(fragment) ||
    causeIndex.includes(fragment) ||
    causeFields.includes(fragment)
  )
}
