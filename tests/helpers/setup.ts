/**
 * Global test setup for Vitest.
 *
 * Sets environment variables required by the application (encryption key, etc.)
 * BEFORE any module is imported. This file is referenced in vitest.config.ts setupFiles.
 *
 * IMPORTANT: The key below is a TEST-ONLY key. It must never be used in production.
 * It is a valid 32-byte (64 hex chars) key for AES-256-GCM.
 */

// Test encryption key — 32 bytes in hex (64 hex characters)
// Generated with: crypto.randomBytes(32).toString("hex")
process.env.HEALTH_DATA_ENCRYPTION_KEY =
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"

// HMAC secret for email lookup
process.env.HMAC_SECRET = "test-hmac-secret-32-bytes-long!!"

// US-2076 HIGH-2 review round 5 — Pepper HMAC pour conversation_key.
// 32 bytes hex test-only — generate via crypto.randomBytes(32).toString("hex").
process.env.CONVERSATION_KEY_PEPPER =
  "f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff00"

// US-2026 H1 review round 2 — Pepper HMAC pour audit anonymisation IDs.
// Distinct de CONVERSATION_KEY_PEPPER + HMAC_SECRET (RGS §B1.2 cross-domain).
process.env.AUDIT_PEPPER =
  "aa00bb11cc22dd33ee44ff5566778899aabbccddeeff00112233445566778899"
