/**
 * Apple touch icon — Next.js App Router convention.
 *
 * Génère `/apple-icon` (180×180 PNG) consommé en `<link rel="apple-touch-icon">`.
 * Affiché par iOS quand l'utilisateur ajoute Diabeo à l'écran d'accueil.
 *
 * Couleurs depuis `src/design-system/tokens.ts` — cohérent avec `icon.tsx`
 * et le composant `Logo`.
 */

import { ImageResponse } from "next/og"
import { tokens } from "@/design-system/tokens"

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: tokens.brand.primary[600],
          borderRadius: 36,
        }}
      >
        <svg
          viewBox="0 0 48 48"
          width={140}
          height={140}
          xmlns="http://www.w3.org/2000/svg"
        >
          <g transform="rotate(-6 24 24)">
            <path
              d="M24 3 C 33 14, 40 22, 40 29 A 16 16 0 1 1 8 29 C 8 22, 15 14, 24 3 Z"
              fill={tokens.white}
            />
            <path
              d="M11 30 C 14 24, 18 24, 21 30 C 24 36, 28 36, 31 30 C 33 26, 35 26, 37 28"
              fill="none"
              stroke={tokens.brand.primary[600]}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx={37}
              cy={28}
              r={2.4}
              fill={tokens.brand.secondary[500]}
              stroke={tokens.brand.primary[600]}
              strokeWidth={1}
            />
          </g>
        </svg>
      </div>
    ),
    size,
  )
}
