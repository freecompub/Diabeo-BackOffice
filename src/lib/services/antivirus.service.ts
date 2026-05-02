import NodeClam from "clamscan"
import { existsSync } from "fs"
import { writeFile, rm, mkdtemp } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"

let clamInstance: NodeClam | null = null

async function getClamAV(): Promise<NodeClam | null> {
  if (clamInstance) return clamInstance

  try {
    clamInstance = await new NodeClam().init({
      removeInfected: true,
      quarantineInfected: false,
      debugMode: false,
      clamdscan: {
        socket: "/var/run/clamav/clamd.ctl",
        timeout: 60000,
        active: true,
      },
      clamscan: {
        path: "/usr/bin/clamscan",
        active: true,
      },
    })
    return clamInstance
  } catch {
    console.warn("[antivirus] ClamAV not available — scans will be skipped")
    return null
  }
}

export interface ScanResult {
  scanned: boolean
  clean: boolean
  viruses: string[]
}

export async function scanFile(filePath: string): Promise<ScanResult> {
  if (!existsSync(filePath)) {
    throw new Error("File not found for scan")
  }

  const clam = await getClamAV()

  if (!clam) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("[antivirus] ClamAV unavailable in production — refusing to process file")
    }
    return { scanned: false, clean: true, viruses: [] }
  }

  try {
    const result = await clam.scanFile(filePath)
    const isClean = result.isInfected === false

    if (!isClean) {
      console.error("[antivirus] INFECTED file detected:", result.viruses?.join(", "))
    }

    return {
      scanned: true,
      clean: isClean,
      viruses: result.viruses ?? [],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    console.error("[antivirus] Scan failed:", msg)
    return { scanned: false, clean: false, viruses: ["SCAN_ERROR"] }
  }
}

export async function scanBuffer(buffer: Buffer, safeFileName: string): Promise<ScanResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), "diabeo-scan-"))
  const tmpPath = join(tmpDir, safeFileName.replace(/[^a-zA-Z0-9._-]/g, "_"))
  try {
    await writeFile(tmpPath, buffer)
    return await scanFile(tmpPath)
  } finally {
    await rm(tmpDir, { recursive: true }).catch(() => {})
  }
}
