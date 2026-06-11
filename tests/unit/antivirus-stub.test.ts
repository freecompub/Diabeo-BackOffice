/**
 * @vitest-environment node
 */

/**
 * Tests — stub antivirus du mode dev mocké (US-2270).
 *
 * Comportement clinique/sécurité testé : un document uploadé doit TOUJOURS être
 * scanné en production. Le bypass `MOCK_ANTIVIRUS` ne doit JAMAIS neutraliser le
 * scan en prod, et le fail-closed prod (refus si ClamAV indisponible) doit tenir.
 * Risque couvert : un faux `clean:true` = malware stocké → faille HDS.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest"
import { writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

// ClamAV indisponible de façon déterministe (init rejette) → getClamAV() = null.
vi.mock("clamscan", () => ({
  default: class {
    init() {
      return Promise.reject(new Error("ClamAV not available in test env"))
    }
  },
}))

import { scanFile } from "@/lib/services/antivirus.service"

const tmpFile = join(tmpdir(), "diabeo-av-stub-test.txt")

beforeAll(() => writeFileSync(tmpFile, "harmless content"))
afterAll(() => rmSync(tmpFile, { force: true }))
afterEach(() => vi.unstubAllEnvs())

describe("scanFile — mode dev mocké", () => {
  it("dev + MOCK_ANTIVIRUS=true → scan neutralisé (clean, non scanné)", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MOCK_ANTIVIRUS", "true")
    const res = await scanFile(tmpFile)
    expect(res).toEqual({ scanned: false, clean: true, viruses: [] })
  })

  it("PRODUCTION + MOCK_ANTIVIRUS=true → bypass IGNORÉ, ClamAV indispo → throw (fail-closed)", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("MOCK_ANTIVIRUS", "true")
    await expect(scanFile(tmpFile)).rejects.toThrow(/ClamAV unavailable in production/)
  })

  it("dev SANS flag + ClamAV indispo → skip toléré (clean, non scanné)", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MOCK_ANTIVIRUS", "")
    const res = await scanFile(tmpFile)
    expect(res).toEqual({ scanned: false, clean: true, viruses: [] })
  })

  it("fichier inexistant → throw", async () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("MOCK_ANTIVIRUS", "true")
    await expect(scanFile(join(tmpdir(), "does-not-exist-xyz.bin"))).rejects.toThrow(/File not found/)
  })
})
