/**
 * renderGlyphForOg — glyph Diabeo pour next/og ImageResponse.
 *
 * Partagé entre `src/app/icon.tsx` (32×32) et `src/app/apple-icon.tsx`
 * (180×180) pour éliminer la duplication (les deux fichiers étaient à 95%
 * identiques). Toute modification visuelle du favicon se fait ici.
 *
 * Couleurs depuis `src/design-system/tokens.ts` (anti-drift design system).
 */

import { tokens } from "@/design-system/tokens"
import {
  DROP_PATH,
  WAVE_PATH,
  DOT,
  GLYPH_TRANSFORM,
  WAVE_STROKE_WIDTH,
  DOT_OUTLINE_STROKE_WIDTH,
} from "./logo-paths"

export interface RenderGlyphOptions {
  /** Taille de l'image PNG finale (32 pour favicon, 180 pour apple-icon). */
  outerSize: number
  /** Taille du SVG inline dans le carré teal de fond (28 ou 140). */
  innerSize: number
  /** Arrondis du carré teal de fond (6px favicon, 36px apple-icon). */
  borderRadius: number
}

/**
 * Rend le glyph Diabeo (goutte + onde CGM + point live) dans un carré teal
 * arrondi, prêt à être passé à `new ImageResponse(...)`.
 *
 * La fonction retourne du JSX — elle est appelée depuis des Server Components
 * (icon.tsx / apple-icon.tsx) et ne peut donc PAS utiliser de hooks React.
 * Les imports `next/og` gèrent leur propre moteur de rendu (Satori).
 */
export function renderGlyphForOg({ outerSize, innerSize, borderRadius }: RenderGlyphOptions) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: tokens.brand.primary[600],
        borderRadius,
      }}
    >
      <svg
        viewBox="0 0 48 48"
        width={innerSize}
        height={innerSize}
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
            strokeWidth={WAVE_STROKE_WIDTH}
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
            strokeWidth={DOT_OUTLINE_STROKE_WIDTH}
          />
        </g>
      </svg>
    </div>
  )
}
