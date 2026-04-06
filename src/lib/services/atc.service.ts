/**
 * ATC (Anatomical Therapeutic Chemical) classification import service.
 *
 * Downloads the WHO ATC classification from the open-source fabkury/atcd
 * GitHub repository and imports it into the AtcClassification table.
 *
 * Source: https://github.com/fabkury/atcd
 * Data: WHO ATC-DDD 2024-07-31.csv (~7,300 codes)
 * License: WHO open data
 *
 * ATC hierarchy (5 levels):
 *   A        → Level 1: Anatomical main group (14 groups)
 *   A10      → Level 2: Therapeutic subgroup
 *   A10B     → Level 3: Pharmacological subgroup
 *   A10BA    → Level 4: Chemical subgroup
 *   A10BA02  → Level 5: Chemical substance (e.g., Metformine)
 *
 * French translations are included for levels 1-2 (14+100 categories).
 * Level 3-5 labels are in English from the WHO source.
 *
 * @see US-1000b — Classification ATC
 */

import { prisma } from "@/lib/db/client"
import { scanFile } from "./antivirus.service"
import { writeFile, mkdir, unlink } from "fs/promises"
import { existsSync } from "fs"
import path from "path"

const ATC_CSV_URL =
  "https://raw.githubusercontent.com/fabkury/atcd/master/WHO%20ATC-DDD%202024-07-31.csv"
const DOWNLOAD_DIR = "/tmp/diabeo-bdpm"
const BATCH_SIZE = 500

// ── French translations for ATC levels 1-2 ─────────────────

const ATC_FR_LEVEL1: Record<string, string> = {
  A: "Voies digestives et métabolisme",
  B: "Sang et organes hématopoïétiques",
  C: "Système cardiovasculaire",
  D: "Dermatologie",
  G: "Système génito-urinaire et hormones sexuelles",
  H: "Hormones systémiques (hors hormones sexuelles et insulines)",
  J: "Anti-infectieux à usage systémique",
  L: "Antinéoplasiques et immunomodulateurs",
  M: "Système musculo-squelettique",
  N: "Système nerveux",
  P: "Antiparasitaires, insecticides et répulsifs",
  R: "Système respiratoire",
  S: "Organes sensoriels",
  V: "Divers",
}

const ATC_FR_LEVEL2: Record<string, string> = {
  A01: "Préparations stomatologiques",
  A02: "Antiacides et antiulcéreux",
  A03: "Antispasmodiques et anticholinergiques",
  A04: "Antiémétiques et antinauséeux",
  A05: "Thérapeutique biliaire et hépatique",
  A06: "Laxatifs",
  A07: "Antidiarrhéiques et anti-inflammatoires intestinaux",
  A08: "Préparations contre l'obésité",
  A09: "Digestifs (enzymes)",
  A10: "Médicaments du diabète",
  A11: "Vitamines",
  A12: "Suppléments minéraux",
  A13: "Toniques",
  A14: "Anabolisants",
  A15: "Stimulants de l'appétit",
  A16: "Autres voies digestives et métabolisme",
  B01: "Antithrombotiques",
  B02: "Antihémorragiques",
  B03: "Antianémiques",
  B05: "Substituts du sang et solutions de perfusion",
  B06: "Autres agents hématologiques",
  C01: "Thérapeutique cardiaque",
  C02: "Antihypertenseurs",
  C03: "Diurétiques",
  C04: "Vasodilatateurs périphériques",
  C05: "Vasoprotecteurs",
  C07: "Bêtabloquants",
  C08: "Inhibiteurs calciques",
  C09: "Agents du système rénine-angiotensine",
  C10: "Hypolipémiants",
  N02: "Analgésiques",
  N03: "Antiépileptiques",
  N05: "Psycholeptiques",
  N06: "Psychoanaleptiques",
  N07: "Autres médicaments du système nerveux",
}

// ── Import function ────────────────────────────────────────

export interface AtcImportResult {
  count: number
  status: "success" | "error"
  errorMessage?: string
}

/**
 * Download and import the WHO ATC classification.
 * Idempotent — upserts by ATC code.
 */
export async function importAtcClassification(): Promise<AtcImportResult> {
  try {
    // Download CSV
    if (!existsSync(DOWNLOAD_DIR)) {
      await mkdir(DOWNLOAD_DIR, { recursive: true })
    }

    const filePath = path.join(DOWNLOAD_DIR, "atc-who-2024.csv")
    const response = await fetch(ATC_CSV_URL)
    if (!response.ok) {
      throw new Error(`ATC download failed: ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(filePath, buffer)

    // Antivirus scan
    const scanResult = await scanFile(filePath)
    if (!scanResult.clean) {
      await unlink(filePath).catch(() => {})
      throw new Error("Antivirus: fichier ATC suspect")
    }

    // Parse CSV
    const content = buffer.toString("utf-8")
    const lines = content.split("\n").filter((l) => l.trim().length > 0)
    lines.shift() // Remove header

    const entries: Array<{
      code: string
      level: number
      labelEn: string
      labelFr: string
      parentCode: string | null
    }> = []

    for (const line of lines) {
      // CSV with possible quoted fields
      const match = line.match(/^([^,]+),(".*?"|[^,]*),/)
      if (!match) continue

      const code = match[1].trim()
      const labelEn = match[2].replace(/^"|"$/g, "").trim()
      if (!code || !labelEn) continue

      const level = getAtcLevel(code)
      const parentCode = getParentCode(code)
      const labelFr = getAtcFrenchLabel(code, level) ?? labelEn

      entries.push({ code, level, labelEn, labelFr, parentCode })
    }

    // Upsert in batches
    let count = 0
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE)
      const ops = batch.map((e) =>
        prisma.atcClassification.upsert({
          where: { code: e.code },
          create: {
            code: e.code,
            level: e.level,
            labelFr: e.labelFr,
            labelEn: e.labelEn,
            parentCode: e.parentCode,
          },
          update: {
            labelFr: e.labelFr,
            labelEn: e.labelEn,
            parentCode: e.parentCode,
          },
        }),
      )
      await prisma.$transaction(ops)
      count += ops.length
    }

    // Cleanup
    await unlink(filePath).catch(() => {})

    return { count, status: "success" }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    console.error("[atc] Import failed:", msg)
    return { count: 0, status: "error", errorMessage: msg }
  }
}

// ── Helpers ────────────────────────────────────────────────

function getAtcLevel(code: string): number {
  if (code.length === 1) return 1 // A
  if (code.length === 3) return 2 // A10
  if (code.length === 4) return 3 // A10B
  if (code.length === 5) return 4 // A10BA
  return 5 // A10BA02
}

function getParentCode(code: string): string | null {
  if (code.length === 1) return null
  if (code.length === 3) return code[0] // A10 → A
  if (code.length === 4) return code.slice(0, 3) // A10B → A10
  if (code.length === 5) return code.slice(0, 4) // A10BA → A10B
  return code.slice(0, 5) // A10BA02 → A10BA
}

function getAtcFrenchLabel(code: string, level: number): string | null {
  if (level === 1) return ATC_FR_LEVEL1[code] ?? null
  if (level === 2) return ATC_FR_LEVEL2[code] ?? null
  return null // Levels 3-5: English only (from WHO)
}

// ── Query helpers ──────────────────────────────────────────

/**
 * Get ATC hierarchy for a given code (ancestors + children).
 */
export async function getAtcHierarchy(code: string) {
  const ancestors: string[] = []
  let current = code
  while (current.length > 1) {
    current = getParentCode(current) ?? ""
    if (current) ancestors.push(current)
  }

  const [node, children, ancestorNodes] = await Promise.all([
    prisma.atcClassification.findUnique({ where: { code } }),
    prisma.atcClassification.findMany({
      where: { parentCode: code },
      orderBy: { code: "asc" },
    }),
    prisma.atcClassification.findMany({
      where: { code: { in: ancestors } },
      orderBy: { code: "asc" },
    }),
  ])

  return { node, children, ancestors: ancestorNodes }
}
