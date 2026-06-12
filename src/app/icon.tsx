/**
 * App icon — Next.js App Router convention.
 *
 * Génère dynamiquement `/icon` (32×32 PNG) consommé automatiquement par Next.js
 * comme `<link rel="icon">` dans toutes les pages. Aligné sur le composant
 * `Logo` (`src/components/diabeo/brand/Logo.tsx`) — goutte teal avec onde CGM
 * blanche + point de données coral.
 *
 * Couleurs depuis `src/design-system/tokens.ts` (anti-drift design system).
 */

import { ImageResponse } from "next/og"
import { tokens } from "@/design-system/tokens"

export const size = { width: 32, height: 32 }
export const contentType = "image/png"

export default function Icon() {
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
          borderRadius: 6,
        }}
      >
        <svg
          viewBox="0 0 48 48"
          width={28}
          height={28}
          xmlns="http://www.w3.org/2000/svg"
        >
          <g transform="rotate(-6 24 24)">
            {/* Glucose drop */}
            <path
              d="M24 3 C 33 14, 40 22, 40 29 A 16 16 0 1 1 8 29 C 8 22, 15 14, 24 3 Z"
              fill={tokens.white}
            />
            {/* CGM wave */}
            <path
              d="M11 30 C 14 24, 18 24, 21 30 C 24 36, 28 36, 31 30 C 33 26, 35 26, 37 28"
              fill="none"
              stroke={tokens.brand.primary[600]}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Live data point */}
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
