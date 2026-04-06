/**
 * Antivirus scanning service using ClamAV.
 *
 * All files downloaded from external sources MUST be scanned before
 * processing. This is a security requirement for HDS compliance.
 *
 * ClamAV must be installed on the server:
 *   apt install clamav clamav-daemon
 *   systemctl start clamav-daemon
 *
 * In development/CI without ClamAV, the scan is skipped with a warning.
 */

import NodeClam from "clamscan"
import { existsSync } from "fs"

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

/**
 * Scan a file for viruses using ClamAV.
 * Returns { scanned: false } if ClamAV is not available (dev/CI).
 * Returns { scanned: true, clean: true/false } after scan.
 */
export async function scanFile(filePath: string): Promise<ScanResult> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const clam = await getClamAV()

  if (!clam) {
    console.warn(`[antivirus] Skipping scan for ${filePath} — ClamAV not available`)
    return { scanned: false, clean: true, viruses: [] }
  }

  try {
    const result = await clam.scanFile(filePath)
    const isClean = result.isInfected === false

    if (!isClean) {
      console.error(`[antivirus] INFECTED: ${filePath} — ${result.viruses?.join(", ")}`)
    }

    return {
      scanned: true,
      clean: isClean,
      viruses: result.viruses ?? [],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error"
    console.error(`[antivirus] Scan failed for ${filePath}:`, msg)
    // Fail-closed: treat as infected if scan fails
    return { scanned: false, clean: false, viruses: ["SCAN_ERROR"] }
  }
}
