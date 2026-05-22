/**
 * BDPM (Base de Données Publique des Médicaments) import service.
 *
 * Downloads TSV files from the ANSM BDPM portal, scans them with ClamAV,
 * parses tab-separated data, and upserts into PostgreSQL via Prisma.
 *
 * Source: https://base-donnees-publique.medicaments.gouv.fr/telechargement
 * License: Licence Ouverte 2.0 (attribution ANSM/BDPM requise)
 *
 * Files imported:
 * - CIS_bdpm.txt      → BdpmSpecialty (~14,000 rows)
 * - CIS_CIP_bdpm.txt  → BdpmPresentation (~20,000 rows)
 * - CIS_COMPO_bdpm.txt → BdpmComposition (~25,000 rows)
 *
 * Security: all downloaded files are scanned with ClamAV before parsing.
 *
 * @see US-1000 — Intégration BDPM
 */

import { prisma } from "@/lib/db/client"
import { scanFile } from "./antivirus.service"
import { auditService } from "./audit.service"
import { parseTsv, parseDate, parsePrice } from "./bdpm-parsers"
import { writeFile, mkdir, unlink } from "fs/promises"
import { existsSync } from "fs"
import path from "path"

/**
 * Fix #9.bis (session 2026-05-22) — Le site BDPM a été refondu :
 * `telechargement.php` n'existe plus (404). Nouvelle convention :
 *   - Index HTML : `/telechargement`
 *   - Fichiers : `/download/file/<filename>`
 */
const BDPM_BASE_URL = "https://base-donnees-publique.medicaments.gouv.fr/download/file"
const DOWNLOAD_DIR = "/tmp/diabeo-bdpm"
const BATCH_SIZE = 500
const REQUEST_TIMEOUT_MS = 60_000

const BDPM_FILES = {
  specialties: "CIS_bdpm.txt",
  presentations: "CIS_CIP_bdpm.txt",
  compositions: "CIS_COMPO_bdpm.txt",
} as const

export interface BdpmImportResult {
  status: "success" | "error"
  specialtyCount: number
  presentCount: number
  compositionCount: number
  antivirusPassed: boolean
  durationMs: number
  errorMessage?: string
}

// ── Main import function ───────────────────────────────────

/**
 * Download, scan, parse, and import all BDPM files.
 * Idempotent — uses upsert by CodeCIS/CodeCIP13.
 */
export async function importBdpm(
  auditUserId: number,
): Promise<BdpmImportResult> {
  const start = Date.now()
  const files: Record<string, string> = {}

  try {
    // Ensure download directory exists
    if (!existsSync(DOWNLOAD_DIR)) {
      await mkdir(DOWNLOAD_DIR, { recursive: true })
    }

    // Download all files
    for (const [key, filename] of Object.entries(BDPM_FILES)) {
      const filePath = path.join(DOWNLOAD_DIR, filename)
      await downloadFile(filename, filePath)
      files[key] = filePath
    }

    // Antivirus scan all downloaded files
    let allScanned = true
    for (const filePath of Object.values(files)) {
      const scanResult = await scanFile(filePath)
      if (!scanResult.scanned) allScanned = false
      if (!scanResult.clean) {
        throw new Error("Antivirus: fichier suspect détecté — import annulé")
      }
    }

    // Parse and import
    const specialtyCount = await importSpecialties(files.specialties)
    const presentCount = await importPresentations(files.presentations)
    const compositionCount = await importCompositions(files.compositions)

    const result: BdpmImportResult = {
      status: "success",
      specialtyCount,
      presentCount,
      compositionCount,
      antivirusPassed: allScanned,
      durationMs: Date.now() - start,
    }

    await logImport(result)

    await auditService.log({
      userId: auditUserId,
      action: "IMPORT",
      resource: "MEDICATION",
      metadata: {
        source: "bdpm-ansm",
        specialtyCount,
        presentCount,
        compositionCount,
        antivirusPassed: allScanned,
      },
    })

    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    const result: BdpmImportResult = {
      status: "error",
      specialtyCount: 0,
      presentCount: 0,
      compositionCount: 0,
      antivirusPassed: false,
      durationMs: Date.now() - start,
      errorMessage: msg,
    }
    await logImport(result)
    return result
  } finally {
    // Always cleanup downloaded files (M6 fix)
    await cleanupFiles(files)
  }
}

// ── Download ───────────────────────────────────────────────

async function downloadFile(filename: string, destPath: string): Promise<void> {
  // Fix #9.bis — path style (vs ancien query string `?fichier=`).
  const url = `${BDPM_BASE_URL}/${filename}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} for ${filename}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(destPath, buffer)
  } finally {
    clearTimeout(timer)
  }
}

// ── Parse TSV ──────────────────────────────────────────────

async function readAndParse(filePath: string): Promise<string[][]> {
  const { readFile } = await import("fs/promises")
  // BDPM files from ANSM are latin-1 (Windows-1252) encoded
  const content = await readFile(filePath, "latin1")
  return parseTsv(content)
}

// ── Import specialties ─────────────────────────────────────

async function importSpecialties(filePath: string): Promise<number> {
  const rows = await readAndParse(filePath)
  let count = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const ops = batch
      .filter((cols) => cols.length >= 2 && cols[0])
      .map((cols) => {
        const codeCIS = cols[0]
        const data = {
          denomination: cols[1] || "",
          formePharma: cols[2] || "",
          voiesAdmin: cols[3] || "",
          statutAMM: cols[4] || "",
          procedureAMM: cols[5] || null,
          etatComm: cols[6] || null,
          dateAMM: parseDate(cols[7]),
          titulaires: cols[10] || null,
          surveillance: cols[11]?.toLowerCase() === "oui",
        }
        return prisma.bdpmSpecialty.upsert({
          where: { codeCIS },
          create: { codeCIS, ...data },
          update: data,
        })
      })

    await prisma.$transaction(ops)
    count += ops.length
  }

  return count
}

// ── Import presentations ───────────────────────────────────

/**
 * CIS_CIP_bdpm.txt — colonnes (0-based, vérifié 2026-05-22) :
 *   0 CIS · 1 CIP7 · 2 libellé · 3 statut admin · 4 état comm
 *   5 date déclaration · 6 CIP13 · 7 agrément · 8 taux remb · 9 prix · 10 TFR
 *
 * Fix #9.ter (session 2026-05-22) — Anciens indices faux écrivaient
 * le libellé (≤ 274 chars) dans `codeCIP13` (varchar(13)) → crash.
 *
 * Fix #9.quater (session 2026-05-22) — BDPM publie des présentations
 * dont le CIS n'est pas (ou plus) dans CIS_bdpm.txt (décalage entre
 * fichiers, médicaments retirés). Préchargement des CIS valides +
 * filtre avant upsert pour éviter FK violation (même pattern que
 * importCompositions).
 */
async function importPresentations(filePath: string): Promise<number> {
  const rows = await readAndParse(filePath)

  // Fix #9.quater — précharger les CIS valides pour filtrer les orphelins.
  const validCodes = new Set(
    (await prisma.bdpmSpecialty.findMany({
      select: { codeCIS: true },
    })).map((s) => s.codeCIS),
  )

  let count = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const ops = batch
      // Fix #9.ter — CIP13 est en colonne 6, plus en 2. Min 7 colonnes.
      .filter((cols) => cols.length >= 7 && cols[0] && cols[6])
      // Fix #9.quater — ignorer présentations orphelines (CIS absent).
      .filter((cols) => validCodes.has(cols[0]))
      .map((cols) => {
        const codeCIP13 = cols[6]
        const data = {
          codeCIS: cols[0],
          codeCIP7: cols[1] || null,
          libelle: cols[2] || "",
          statutAdmin: cols[3] || null,
          etatComm: cols[4] || null,
          tauxRemb: cols[8] || null,
          prix: parsePrice(cols[9]),
        }
        return prisma.bdpmPresentation.upsert({
          where: { codeCIP13 },
          create: { codeCIP13, ...data },
          update: data,
        })
      })

    await prisma.$transaction(ops)
    count += ops.length
  }

  return count
}

// ── Import compositions ────────────────────────────────────

/**
 * CIS_COMPO_bdpm.txt — colonnes (0-based, vérifié 2026-05-22) :
 *   0 CIS · 1 forme pharma · 2 code substance · 3 substance
 *   4 dosage · 5 référence · 6 nature (SA/FT) · 7 numéro liaison
 *
 * Fix #9.ter (session 2026-05-22) — `nature` était lu en col[1] (forme
 * pharma) au lieu de col[6] (SA/FT). Toutes les compositions étaient
 * persistées avec `nature` = libellé de forme pharmaceutique.
 */
async function importCompositions(filePath: string): Promise<number> {
  const rows = await readAndParse(filePath)

  // Prepare all data first
  const allData = rows
    .filter((cols) => cols.length >= 7 && cols[0] && cols[3])
    .map((cols) => ({
      codeCIS: cols[0],
      substance: cols[3] || "",
      codeSubstance: cols[2] || null,
      dosage: cols[4] || null,
      reference: cols[5] || null,
      // Fix #9.ter — nature en col[6], pas col[1].
      nature: cols[6] || "SA",
    }))

  // Get all valid specialty codes
  const validCodes = new Set(
    (await prisma.bdpmSpecialty.findMany({
      select: { codeCIS: true },
    })).map((s) => s.codeCIS),
  )

  const validData = allData.filter((d) => validCodes.has(d.codeCIS))

  // Atomic delete + insert in a single transaction (C2 fix)
  return prisma.$transaction(async (tx) => {
    await tx.bdpmComposition.deleteMany()

    let count = 0
    for (let i = 0; i < validData.length; i += BATCH_SIZE) {
      const batch = validData.slice(i, i + BATCH_SIZE)
      await tx.bdpmComposition.createMany({ data: batch })
      count += batch.length
    }

    return count
  }, { timeout: 120_000 }) // 2min timeout for large datasets
}

// ── Helpers ────────────────────────────────────────────────

// parseDate, parsePrice, parseTsv are in bdpm-parsers.ts

async function cleanupFiles(files: Record<string, string>): Promise<void> {
  for (const filePath of Object.values(files)) {
    await unlink(filePath).catch(() => {})
  }
}

async function logImport(result: BdpmImportResult): Promise<void> {
  await prisma.bdpmImportLog.create({
    data: {
      version: new Date().toISOString().split("T")[0],
      specialtyCount: result.specialtyCount,
      presentCount: result.presentCount,
      compositionCount: result.compositionCount,
      status: result.status,
      errorMessage: result.errorMessage || null,
      durationMs: result.durationMs,
      antivirusPassed: result.antivirusPassed,
    },
  })
}

// ── Search ─────────────────────────────────────────────────

/**
 * Search medications by name, DCI, or CIP code.
 * Uses PostgreSQL trigram index for fuzzy matching.
 */
export async function searchMedications(
  query: string,
  options: { atcCode?: string; limit?: number } = {},
): Promise<{
  specialties: Array<{
    codeCIS: string
    denomination: string
    formePharma: string
    statutAMM: string
    atcCode: string | null
    titulaires: string | null
    compositions: Array<{ substance: string; dosage: string | null }>
    presentations: Array<{ codeCIP13: string; libelle: string; tauxRemb: string | null; prix: number | null }>
  }>
}> {
  const limit = options.limit ?? 20

  const where: Record<string, unknown> = {}

  if (query.length > 0) {
    // Check if query is a CIP code (all digits)
    if (/^\d{7,13}$/.test(query)) {
      where.presentations = {
        some: {
          OR: [
            { codeCIP7: query },
            { codeCIP13: query },
          ],
        },
      }
    } else {
      // Text search on denomination or substance
      where.OR = [
        { denomination: { contains: query, mode: "insensitive" } },
        { compositions: { some: { substance: { contains: query, mode: "insensitive" } } } },
      ]
    }
  }

  if (options.atcCode) {
    where.atcCode = { startsWith: options.atcCode }
  }

  const results = await prisma.bdpmSpecialty.findMany({
    where,
    include: {
      compositions: {
        where: { nature: "SA" },
        select: { substance: true, dosage: true },
      },
      presentations: {
        select: {
          codeCIP13: true,
          libelle: true,
          tauxRemb: true,
          prix: true,
        },
      },
    },
    take: limit,
    orderBy: { denomination: "asc" },
  })

  return {
    specialties: results.map((r) => ({
      codeCIS: r.codeCIS,
      denomination: r.denomination,
      formePharma: r.formePharma,
      statutAMM: r.statutAMM,
      atcCode: r.atcCode,
      titulaires: r.titulaires,
      compositions: r.compositions.map((c) => ({
        substance: c.substance,
        dosage: c.dosage,
      })),
      presentations: r.presentations.map((p) => ({
        codeCIP13: p.codeCIP13,
        libelle: p.libelle,
        tauxRemb: p.tauxRemb,
        prix: p.prix ? Number(p.prix) : null,
      })),
    })),
  }
}

/**
 * Get the latest BDPM import log.
 */
export async function getLatestImportLog() {
  return prisma.bdpmImportLog.findFirst({
    orderBy: { createdAt: "desc" },
  })
}
