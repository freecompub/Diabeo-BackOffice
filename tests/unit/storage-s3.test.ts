/**
 * Test suite: S3 Storage — Object key generation and MIME-to-extension mapping
 *
 * Clinical behavior tested:
 * - Object keys use UUID (no user-supplied filenames in S3 paths)
 * - Extension derived from MIME type, not user input (prevents .exe/.php)
 * - Unknown MIME types produce no extension (safe default)
 */
import { describe, it, expect } from "vitest"
import { generateObjectKey } from "@/lib/storage/s3"

describe("generateObjectKey", () => {
  it("generates key with correct prefix and PDF extension", () => {
    const key = generateObjectKey("documents", "application/pdf")
    expect(key).toMatch(/^documents\/[0-9a-f-]+\.pdf$/)
  })

  it("generates key with JPEG extension for image/jpeg", () => {
    const key = generateObjectKey("avatars", "image/jpeg")
    expect(key).toMatch(/^avatars\/[0-9a-f-]+\.jpg$/)
  })

  it("generates key with PNG extension", () => {
    const key = generateObjectKey("avatars", "image/png")
    expect(key).toMatch(/^avatars\/[0-9a-f-]+\.png$/)
  })

  it("generates key with WebP extension", () => {
    const key = generateObjectKey("documents", "image/webp")
    expect(key).toMatch(/^documents\/[0-9a-f-]+\.webp$/)
  })

  it("generates key with DOCX extension", () => {
    const key = generateObjectKey("documents", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    expect(key).toMatch(/^documents\/[0-9a-f-]+\.docx$/)
  })

  it("generates key with no extension for unknown MIME type", () => {
    const key = generateObjectKey("documents", "application/octet-stream")
    expect(key).toMatch(/^documents\/[0-9a-f-]+$/)
    expect(key).not.toContain(".")
  })

  it("generates unique keys for same inputs", () => {
    const key1 = generateObjectKey("documents", "application/pdf")
    const key2 = generateObjectKey("documents", "application/pdf")
    expect(key1).not.toBe(key2)
  })
})
