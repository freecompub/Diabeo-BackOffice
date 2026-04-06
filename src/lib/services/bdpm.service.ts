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
import { writeFile, mkdir, unlink } from "fs/promises"
import { existsSync } from "fs"
import path from "path"

const BDPM_BASE_URL = "https://base-donnees-publique.medicaments.gouv.fr/telechargement.php"
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

  try {
    // Ensure download directory exists
    if (!existsSync(DOWNLOAD_DIR)) {
      await mkdir(DOWNLOAD_DIR, { recursive: true })
    }

    // Download all files
    const files: Record<string, string> = {}
    for (const [key, filename] of Object.entries(BDPM_FILES)) {
      const filePath = path.join(DOWNLOAD_DIR, filename)
      await downloadFile(filename, filePath)
      files[key] = filePath
    }

    // Antivirus scan all downloaded files
    let allClean = true
    for (const filePath of Object.values(files)) {
      const scanResult = await scanFile(filePath)
      if (!scanResult.clean) {
        allClean = false
        // Delete infected file immediately
        await unlink(filePath).catch(() => {})
        throw new Error(`Antivirus: fichier infecté détecté — ${filePath}: ${scanResult.viruses.join(", ")}`)
      }
    }

    // Parse and import
    const specialtyCount = await importSpecialties(files.specialties)
    const presentCount = await importPresentations(files.presentations)
    const compositionCount = await importCompositions(files.compositions)

    // Log import
    const result: BdpmImportResult = {
      status: "success",
      specialtyCount,
      presentCount,
      compositionCount,
      antivirusPassed: allClean,
      durationMs: Date.now() - start,
    }

    await logImport(result)

    await auditService.log({
      userId: auditUserId,
      action: "IMPORT",
      resource: "PATIENT", // Using existing type — BDPM import
      metadata: {
        source: "bdpm-ansm",
        specialtyCount,
        presentCount,
        compositionCount,
        antivirusPassed: allClean,
      },
    })

    // Cleanup downloaded files
    await cleanupFiles(files)

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
  }
}

// ── Download ───────────────────────────────────────────────

async function downloadFile(filename: string, destPath: string): Promise<void> {
  const url = `${BDPM_BASE_URL}?fichier=${filename}`
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

function parseTsv(content: string): string[][] {
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t").map((field) => field.trim()))
}

async function readAndParse(filePath: string): Promise<string[][]> {
  const { readFile } = await import("fs/promises")
  // BDPM files are typically latin-1 or UTF-8
  let content: string
  try {
    content = await readFile(filePath, "utf-8")
    // Check for encoding issues (common with latin-1 files)
    if (content.includes("�")) {
      content = await readFile(filePath, "latin1")
    }
  } catch {
    content = await readFile(filePath, "latin1")
  }
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

async function importPresentations(filePath: string): Promise<number> {
  const rows = await readAndParse(filePath)
  let count = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const ops = batch
      .filter((cols) => cols.length >= 4 && cols[0] && cols[2])
      .map((cols) => {
        const codeCIP13 = cols[2]
        const data = {
          codeCIS: cols[0],
          codeCIP7: cols[1] || null,
          libelle: cols[3] || "",
          statutAdmin: cols[4] || null,
          etatComm: cols[5] || null,
          tauxRemb: cols[9] || null,
          prix: parsePrice(cols[10]),
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

async function importCompositions(filePath: string): Promise<number> {
  const rows = await readAndParse(filePath)

  // Delete existing compositions and re-insert (no unique key for upsert)
  await prisma.bdpmComposition.deleteMany()

  let count = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const data = batch
      .filter((cols) => cols.length >= 4 && cols[0] && cols[3])
      .map((cols) => ({
        codeCIS: cols[0],
        substance: cols[3] || "",
        codeSubstance: cols[2] || null,
        dosage: cols[4] || null,
        reference: cols[5] || null,
        nature: cols[1] || "SA",
      }))

    // Filter out compositions referencing non-existent specialties
    const validCodes = new Set(
      (await prisma.bdpmSpecialty.findMany({
        where: { codeCIS: { in: data.map((d) => d.codeCIS) } },
        select: { codeCIS: true },
      })).map((s) => s.codeCIS)
    )

    const validData = data.filter((d) => validCodes.has(d.codeCIS))

    if (validData.length > 0) {
      await prisma.bdpmComposition.createMany({ data: validData })
      count += validData.length
    }
  }

  return count
}

// ── Helpers ────────────────────────────────────────────────

function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null
  // BDPM dates can be DD/MM/YYYY or YYYY-MM-DD
  const parts = dateStr.split("/")
  if (parts.length === 3) {
    const [day, month, year] = parts
    const d = new Date(`${year}-${month}-${day}`)
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

function parsePrice(priceStr: string | undefined): number | null {
  if (!priceStr) return null
  // French format: "12,50" or "12.50"
  const cleaned = priceStr.replace(",", ".").replace(/[^\d.]/g, "")
  const price = parseFloat(cleaned)
  return Number.isFinite(price) ? price : null
}

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
