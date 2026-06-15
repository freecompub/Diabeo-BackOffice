/**
 * Tests du mapping pur documents médicaux → vue dossier (Phase 4).
 * Couvre : formatage de taille (o/Ko/Mo), projection des champs, date→ISO.
 */

import { describe, it, expect } from "vitest"
import { formatDocSize, buildDocumentView } from "@/app/(dashboard)/patients/[id]/document-view"

describe("formatDocSize", () => {
  it("formats bytes / KB / MB with rounded values", () => {
    expect(formatDocSize(512)).toEqual({ value: 512, unitKey: "sizeBytes" })
    expect(formatDocSize(2048)).toEqual({ value: 2, unitKey: "sizeKb" })
    expect(formatDocSize(1_572_864)).toEqual({ value: 1.5, unitKey: "sizeMb" })
  })
  it("returns null for unknown/invalid size", () => {
    expect(formatDocSize(null)).toBeNull()
    expect(formatDocSize(undefined)).toBeNull()
    expect(formatDocSize(-1)).toBeNull()
  })
})

describe("buildDocumentView", () => {
  it("projects display fields + ISO date + formatted size", () => {
    const out = buildDocumentView([
      { id: 7, title: "CR HDJ", category: "labResults", date: new Date("2026-06-01T09:00:00.000Z"), fileSize: 1_048_576 },
      { id: 8, title: "Note", category: null, date: "2026-05-01T00:00:00.000Z", fileSize: null },
    ])
    expect(out[0]).toEqual({
      id: 7, title: "CR HDJ", category: "labResults",
      dateIso: "2026-06-01T09:00:00.000Z", size: { value: 1, unitKey: "sizeMb" },
    })
    expect(out[1]!.size).toBeNull()
    expect(out[1]!.dateIso).toBe("2026-05-01T00:00:00.000Z")
  })
})
