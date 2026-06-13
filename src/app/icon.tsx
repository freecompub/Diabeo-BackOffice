/**
 * App icon — Next.js App Router convention.
 *
 * Génère dynamiquement `/icon` (32×32 PNG) consommé automatiquement par Next.js
 * comme `<link rel="icon">` dans toutes les pages. Aligné sur le composant
 * `Logo` (`src/components/diabeo/brand/Logo.tsx`) — goutte teal avec onde CGM
 * blanche + point de données coral.
 *
 * Le glyph SVG est factorisé dans `render-glyph.tsx` (partagé avec apple-icon).
 */

import { ImageResponse } from "next/og"
import { renderGlyphForOg } from "@/components/diabeo/brand/render-glyph"

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
    renderGlyphForOg({ outerSize: 32, innerSize: 28, borderRadius: 6 }),
    size,
  )
}
