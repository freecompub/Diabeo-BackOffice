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

// Suppress Prisma connection warnings in tests
process.env.NODE_ENV = "test"
