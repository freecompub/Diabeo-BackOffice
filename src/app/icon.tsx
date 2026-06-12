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
import {
  DROP_PATH,
  WAVE_PATH,
  DOT,
  GLYPH_TRANSFORM,
  STROKE_WIDTH,
} from "@/components/diabeo/brand/logo-paths"

export const size = { width: 32, height: 32 }
export const contentType = "image/png"

// Le glyph est immutable au build (depend uniquement des `tokens` constants).
// `force-static` fige le PNG au build → 0 invocation runtime sur chaque page
// load. Sans ça, `ImageResponse` peut être re-évalué à chaque cold-start
// serverless (~5-15ms CPU satori). Cf. https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons
export const dynamic = "force-static"
export const revalidate = false

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
          <g transform={GLYPH_TRANSFORM}>
            {/* Glucose drop */}
            <path d={DROP_PATH} fill={tokens.white} />
            {/* CGM wave */}
            <path
              d={WAVE_PATH}
              fill="none"
              stroke={tokens.brand.primary[600]}
              strokeWidth={STROKE_WIDTH.wave}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Live data point */}
            <circle
              cx={DOT.cx}
              cy={DOT.cy}
              r={DOT.r}
              fill={tokens.brand.secondary[500]}
              stroke={tokens.brand.primary[600]}
              strokeWidth={STROKE_WIDTH.dotOutline}
            />
          </g>
        </svg>
      </div>
    ),
    size,
  )
}
