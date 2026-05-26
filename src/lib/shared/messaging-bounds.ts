/**
 * Shared messaging bounds — single source of truth backend + frontend.
 *
 * Fix H1 round 1 review PR #443 — Le frontend (`ThreadViewer.tsx`) avait
 * une const `MAX_BODY_BYTES_UTF8 = 8164` hardcodée, dupliquée avec backend
 * `MESSAGING_BOUNDS.MAX_BODY_BYTES_UTF8` (`src/lib/services/messaging.service.ts`).
 *
 * Drift risk : si backend bump à 16384 (V1.5), frontend rejette toujours
 * silencieusement les messages valides → user voit "Le message dépasse la
 * limite autorisée" alors que backend accepterait.
 *
 * Ce module est isomorphic : importable depuis backend (`@/lib/services/...`)
 * ET frontend (`@/components/diabeo/messaging/...`). Aucune dépendance
 * runtime (pas de Prisma, pas de fetch, pas d'env).
 */

/**
 * Cap en octets UTF-8 plaintext (BLOCKER #1 fix review round 3 PR #412).
 *
 * Aligné sur le CHECK SQL `OCTET_LENGTH(body_encrypted) <= 8192` :
 * `ciphertext_bytes = plaintext_utf8_bytes + IV(12) + TAG(16)`
 * Donc plaintext ≤ 8192 - 28 = **8164 octets UTF-8**.
 *
 * Si bump à V1.5/V2 : update ICI + migration SQL `body_encrypted` CHECK.
 */
export const MAX_BODY_BYTES_UTF8 = 8164

/**
 * Quota anti-spam : 100 messages / minute / user (backend `checkAndRecordSendRate`).
 * Utilisé UI uniquement pour information (le backend enforce via Redis).
 */
export const SEND_RATE_LIMIT_PER_MIN = 100

/** Pagination thread (max messages par page backend). */
export const MAX_MESSAGES_PER_PAGE = 50

/** Pagination inbox (max threads par page backend). */
export const MAX_THREADS_PER_QUERY = 100

/** Longueur exacte de `conversation_key` (SHA-256 hex). */
export const CONVERSATION_KEY_LEN = 64
