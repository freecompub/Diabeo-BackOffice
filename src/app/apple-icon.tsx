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
import {
  DROP_PATH,
  WAVE_PATH,
  DOT,
  GLYPH_TRANSFORM,
  STROKE_WIDTH,
} from "@/components/diabeo/brand/logo-paths"

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

// Statique au build — voir le rationnel dans `src/app/icon.tsx`. Pour
// l'apple-icon 180×180, le coût d'une régénération est ~32× celui du PNG 32×32.
export const dynamic = "force-static"
export const revalidate = false

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
          <g transform={GLYPH_TRANSFORM}>
            <path d={DROP_PATH} fill={tokens.white} />
            <path
              d={WAVE_PATH}
              fill="none"
              stroke={tokens.brand.primary[600]}
              strokeWidth={STROKE_WIDTH.wave}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
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
