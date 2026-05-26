/**
 * messaging-error-keys — mapping centralisé code erreur backend → clé i18n.
 *
 * Fix M1 round 1 review PR #444 — `composerErrorI18nKey` dupliquée entre
 * `ThreadViewer.tsx` (iter 3) et `NewThreadModal.tsx` (iter 4). Single
 * source of truth pour éviter drift.
 *
 * Pattern aligné `messaging-bounds.ts` iter 3 fix H1.
 */

import type { SendMessageErrorCode } from "@/components/diabeo/messaging/useSendMessage"

/**
 * Map un code erreur `useSendMessage` à une clé i18n `messages.composerError*`.
 *
 * Fallback `composerErrorGeneric` si code inconnu — i18n garantit que la
 * clé existe dans `messages/{fr,en,ar}.json` (Fix M11 round 1 PR #444 —
 * tests vérifient toutes clés présentes).
 *
 * @param code Code retourné par `useSendMessage.send()` outcome.code
 * @returns Clé i18n complète à passer à `useTranslations("messages")(...)`
 */
export function composerErrorI18nKey(code: SendMessageErrorCode): string {
  switch (code) {
    case "forbidden":
      return "composerErrorForbidden"
    case "gdprConsentRevoked":
      return "composerErrorConsent"
    case "bodyTooLong":
      return "composerErrorTooLong"
    case "bodyEmpty":
      return "composerErrorEmpty"
    case "rateLimited":
      return "composerErrorRateLimited"
    case "networkError":
      return "composerErrorNetwork"
    case "unexpectedError":
      return "composerErrorGeneric"
    default: {
      // Exhaustive check — TS compile fail si nouveau code ajouté à
      // SendMessageErrorCode sans update mapping.
      const _exhaustive: never = code
      void _exhaustive
      return "composerErrorGeneric"
    }
  }
}
